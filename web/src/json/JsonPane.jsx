// Lab-owned shim, not a vendored file. The canonical shared/evidence/StepDetailPanel.jsx imports "../json/JsonPane.jsx" and the
// canonical shared/gateway-trace/GatewayTrace.jsx imports "../components/JsonPane". Both must reach ONE JsonPane module, or the
// Form/JSON choice (module-level state) would split in two. The vendored copy lives in components/; this re-exports it.
export * from "../components/JsonPane.jsx";
export { default } from "../components/JsonPane.jsx";
