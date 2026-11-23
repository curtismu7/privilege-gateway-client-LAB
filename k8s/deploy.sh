#!/usr/bin/env bash
# Deploy the owner-run REAL instance to the SE cluster (spec docs/specs/2026-11-23-se-hosted-real.md). It refuses unless OWNER_APPROVED=1 is set
# by the owner. It never builds or pushes an image, and it never creates or prints the Secret: the owner creates privilege-gateway-client-real
# with kubectl (see docs/hosted.md). This script only checks that the Secret holds every setting NAME it needs (values are never read).
#
#   OWNER_APPROVED=1 NAMESPACE=<ns> IMAGE=<registry>/<repo>/privilege-gateway-client-lab:<sha> SE_HOST=<host> INGRESS_CLASS=<class> CLUSTER_ISSUER=<issuer> k8s/deploy.sh [--dry-run]
#
# After the deploy (not done by this script): verify by CONTENT (GET /api/info: source real, hosted.signinRequired true, agent.via llm-gateway),
# check the pod's imageID against the registry digest, sign in and run the three doors and the agent in a browser, then hand over the URL.
set -euo pipefail
cd "$(dirname "$0")"

[ "${OWNER_APPROVED:-}" = "1" ] || { echo "refusing: deploying the hosted Real instance is owner-approved (set OWNER_APPROVED=1)" >&2; exit 2; }
for v in NAMESPACE IMAGE SE_HOST INGRESS_CLASS CLUSTER_ISSUER; do [ -n "${!v:-}" ] || { echo "refusing: set $v (see the usage line)" >&2; exit 2; }; done
case "$IMAGE" in
  *:latest|*:HEAD|*:|*[!A-Za-z0-9._:/@-]*|"") echo "refusing: IMAGE must carry an explicit immutable tag or digest, not latest/HEAD" >&2; exit 2;;
esac
# The tag is on the last path segment (a colon earlier may be a registry port); a digest (@sha256:) also counts.
case "$IMAGE" in *@sha256:*) ;; *) case "${IMAGE##*/}" in *:*) ;; *) echo "refusing: IMAGE has no tag" >&2; exit 2;; esac;; esac
case "$NAMESPACE" in *[!a-z0-9-]*|"") echo "refusing: NAMESPACE must be a plain name" >&2; exit 2;; esac
case "$SE_HOST" in *[!a-z0-9.-]*|"") echo "refusing: SE_HOST must be a plain host name" >&2; exit 2;; esac
for v in INGRESS_CLASS CLUSTER_ISSUER; do case "${!v}" in *[!a-z0-9.-]*|"") echo "refusing: $v must be a plain name" >&2; exit 2;; esac; done

render() {
  local out
  out=$(sed -e "s|__IMAGE__|$IMAGE|g" -e "s|__SE_HOST__|$SE_HOST|g" -e "s|__INGRESS_CLASS__|$INGRESS_CLASS|g" -e "s|__CLUSTER_ISSUER__|$CLUSTER_ISSUER|g" "$1")
  if grep -qE '__[A-Z_]+__' <<<"$out"; then echo "refusing: unreplaced __TOKEN__ in $1" >&2; exit 2; fi
  printf '%s\n---\n' "$out"
}
if [ "${1:-}" = "--dry-run" ]; then render deployment.yaml; render service.yaml; render certificate.yaml; render ingress.yaml; exit 0; fi

# The Secret must exist and name every setting the hosted instance needs. Only key NAMES are listed; no value is read or printed.
REQUIRED="PGC_GW_URL PGC_GW_APPS PGC_GW_KEY_DEMO_ALL_TOOLS PGC_GW_KEY_DEMO_SOME_TOOLS PGC_GW_KEY_DEMO_BLOCKED PGC_LLM_GATEWAY_URL PGC_LLM_VIRTUAL_KEY PGC_AGENT_MODEL PGC_PINGONE_ENVIRONMENT_ID PGC_PINGONE_REGION PGC_USER_CLIENT_ID PGC_SESSION_SECRET"
names=$(kubectl -n "$NAMESPACE" get secret privilege-gateway-client-real -o go-template='{{range $k, $v := .data}}{{$k}}{{"\n"}}{{end}}') \
  || { echo "refusing: Secret privilege-gateway-client-real not found in $NAMESPACE (see docs/hosted.md)" >&2; exit 2; }
missing=""; for k in $REQUIRED; do grep -qx "$k" <<<"$names" || missing="$missing $k"; done
[ -z "$missing" ] || { echo "refusing: the Secret lacks:$missing" >&2; exit 2; }
grep -qx PGC_ANTHROPIC_API_KEY <<<"$names" && { echo "refusing: the hosted instance reaches the model through the LLM gateway only; remove PGC_ANTHROPIC_API_KEY from the Secret" >&2; exit 2; }

for f in deployment.yaml service.yaml certificate.yaml ingress.yaml; do render "$f" | kubectl apply -n "$NAMESPACE" -f -; done
kubectl -n "$NAMESPACE" rollout status deployment/privilege-gateway-client --timeout=180s
kubectl -n "$NAMESPACE" wait certificate/privilege-gateway-client --for=condition=Ready --timeout=600s || echo "certificate not Ready yet: check 'kubectl -n $NAMESPACE describe certificate privilege-gateway-client'" >&2
