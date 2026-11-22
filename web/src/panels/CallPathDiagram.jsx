import React, { useEffect, useMemo, useRef } from "react";
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowNoLabel, EdgeLabels, FitOpen, Passport, PassportActions } from "../diagram-kit/DiagramKit.jsx";
import { boxPassport, sidePoint } from "../diagram-kit/diagramKit.js";
import "../diagram-kit/diagram-kit.css";
import Icon from "../Icon.jsx";
import { ICONS } from "../verdictView.js";
import { visible } from "../safeText.js";
import { graphOf, outcomeNode, pathEdges, stepForHop } from "../diagrams/callPath.js";

// The call-path diagram: ReactFlow through the shared diagram-kit, drawn ENTIRELY from diagram-studio/1 data (diagrams/pgc-call-path.json, loaded by
// name). This file builds no node and no edge by hand: it maps each box and arrow of the data to what ReactFlow needs. A function of its props
// (the data, the run's hops, the one walkthrough, the moved boxes), because a popped-out panel is a separate React root.
const HANDLES = [["t", Position.Top], ["b", Position.Bottom], ["l", Position.Left], ["r", Position.Right]];
// Room above and below for the arrow labels the kit places outside the boxes (the loops of a reply arrow, a label that slid clear of a box).
const FIT = { padding: { top: "13%", bottom: "17%", left: "3%", right: "3%" } };

function Box({ data }) {
  const verdictId = data.id.startsWith("verdict-") ? data.id.slice(8) : null;
  const open = Boolean(data.passport);
  return (
    <div className={`pgc-dgbox${open ? " dk-open" : ""}`} data-color={data.color} data-lit={data.lit ? "true" : "false"} data-outcome={data.outcome ? "true" : "false"} data-testid={`dg-node-${data.id}`}>
      {HANDLES.map(([k, pos]) => (
        <span key={k}>
          <Handle id={`s-${k}`} type="source" position={pos} className="pgc-dg-handle" />
          <Handle id={`t-${k}`} type="target" position={pos} className="pgc-dg-handle" />
        </span>
      ))}
      <p className="pgc-dgbox__t">{verdictId && ICONS[verdictId] ? <Icon name={ICONS[verdictId]} /> : null}<span>{visible(data.label)}</span>{data.outcome ? <span className="pgc-dgbox__tag" data-testid="dg-outcome-tag">This run</span> : null}</p>
      {data.sub?.length && (open || !verdictId) ? (open ? <ul className="pgc-dgbox__sub">{data.sub.map((s) => <li key={s}>{visible(s)}</li>)}</ul> : <p className="pgc-dgbox__s">{visible(data.sub[0])}</p>) : null}
      {data.passport ? <Passport p={data.passport} /> : null}
    </div>
  );
}
const nodeTypes = { box: Box };
const edgeTypes = { arrow: ArrowNoLabel };

// The sides of the two boxes that face each other, so an arrow leaves toward its target. An arrow that runs back along a pair already drawn
// uses the bottom (or right) of both, so the two never lie on one line.
function sides(a, b, reverse) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const [s, t] = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ["r", "l"] : ["l", "r"]) : (dy > 0 ? ["b", "t"] : ["t", "b"]);
  return reverse ? (s === "l" || s === "r" ? ["b", "b"] : ["r", "r"]) : [s, t];
}

// The view. Wide (a desktop panel): the whole diagram is fitted on mount and again when the panel is resized, never while the person pans or zooms.
// Narrow (a phone sheet, under NARROW px): the whole diagram would be too small to read, so the view holds a readable zoom and FOLLOWS the walk: it moves
// to the boxes of the arrow in focus (the first two boxes before a walk starts); the person can still pan and zoom.
const NARROW = 520;
const FIRST = ["browser", "lab"];
function ViewFollow({ target, activeIds, firstIds }) {
  const rf = useReactFlow();
  const key = activeIds.join(",");
  useEffect(() => {
    const el = target.current;
    if (!el) return undefined;
    const narrow = () => el.clientWidth < NARROW;
    const go = (duration) => {
      if (narrow()) {
        const ids = (activeIds.length ? activeIds : firstIds).map((id) => ({ id }));
        rf.fitView({ nodes: ids, padding: 0.08, minZoom: 0.7, maxZoom: 0.9, duration });
      } else rf.fitView({ ...FIT, duration });
    };
    let t, last = `${el.clientWidth}x${el.clientHeight}`;
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const now = `${el.clientWidth}x${el.clientHeight}`;
      if (now === last) return;
      last = now;
      clearTimeout(t);
      t = setTimeout(() => go(0), 120);
    });
    ro?.observe(el);
    if (narrow()) { clearTimeout(t); t = setTimeout(() => go(250), 80); } // a step moved the view (a phone only)
    return () => { clearTimeout(t); ro?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rf, target, key]);
  return null;
}

function Canvas({ diagram, graph, hops, verdictId, activeStep, moved, onMove, open, setOpen, refit }) {
  const ref = useRef(null);
  const active = activeStep >= 0 ? diagram.steps[activeStep] : null;
  const activeEdges = useMemo(() => new Set(active?.edges ?? []), [active]);
  const path = useMemo(() => pathEdges(diagram, hops), [diagram, hops]);
  const hasRun = (hops?.length ?? 0) > 0;
  const outcome = outcomeNode(diagram, verdictId);
  const lit = useMemo(() => new Set([...activeEdges].flatMap((i) => [diagram.edges[i].source, diagram.edges[i].target])), [activeEdges, diagram]);
  const pos = (n) => moved[n.id] ?? { x: n.x, y: n.y };

  const nodes = diagram.nodes.map((n) => ({
    id: n.id, type: "box", position: pos(n), draggable: true, zIndex: n.id === open ? 10 : undefined, // an expanded box sits above its neighbours
    data: { id: n.id, label: n.label, sub: n.sub, color: diagram.groups[n.group].color, lit: lit.has(n.id), outcome: hasRun && n.id === outcome, passport: n.id === open ? boxPassport(graph, n.id) : null },
  }));
  const where = Object.fromEntries(diagram.nodes.map((n) => [n.id, pos(n)]));
  const edges = diagram.edges.map((e, i) => {
    const reverse = diagram.edges.slice(0, i).some((o) => o.source === e.target && o.target === e.source);
    const [a, b] = sides(where[e.source], where[e.target], reverse);
    const now = activeEdges.has(i);
    return {
      id: `e${i}`, source: e.source, target: e.target, sourceHandle: `s-${a}`, targetHandle: `t-${b}`, type: "arrow",
      className: `pgc-dg-edge${e.dashed ? " pgc-dg-edge--dashed" : ""}${now ? " pgc-dg-edge--now" : ""}${hasRun && !path.has(i) ? " pgc-dg-edge--off" : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed },
    };
  });
  // One label per arrow, drawn by the kit above the boxes and placed clear of every other label and box. A reply along the same pair of boxes starts a little to one side.
  const labels = diagram.edges.map((e, i) => ({
    id: `e${i}`, text: e.label, source: e.source, target: e.target, sourceHandle: edges[i].sourceHandle, targetHandle: edges[i].targetHandle,
    active: activeEdges.has(i), dim: hasRun && !path.has(i) && !activeEdges.has(i), prefer: diagram.edges.some((o, k) => k !== i && o.source === e.target && o.target === e.source) ? (diagram.edges.slice(0, i).some((o) => o.source === e.target && o.target === e.source) ? 16 : -16) : 0,
  }));
  const actions = useMemo(() => ({
    open: (id) => setOpen(id), close: () => setOpen(null),
    link: (id) => { const u = new URL(window.location.href); u.searchParams.set("box", id); return u.toString(); },
  }), [setOpen]);
  const pointFor = useMemo(() => (box, handle) => sidePoint(box, String(handle).split("-")[1]), []);
  return (
    <div ref={ref} className="pgc-dg-canvas" data-testid="dg-canvas" data-fit-key={refit}>
      <PassportActions.Provider value={actions}>
        <ReactFlow key={refit} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={FIT} nodesConnectable={false} minZoom={0.2} proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => setOpen((o) => (o === n.id ? null : n.id))} onPaneClick={() => setOpen(null)}
          onNodeDrag={(_, n) => onMove(n.id, n.position)} onNodeDragStop={(_, n) => onMove(n.id, n.position)}>
          <Background variant={BackgroundVariant.Dots} gap={18} />
          <Controls showInteractive={false} />
          <EdgeLabels items={labels} pointFor={pointFor} fallback={{ w: 190, h: 70 }} />
          <FitOpen open={open} closePadding={FIT.padding} />
          <ViewFollow target={ref} activeIds={[...lit]} firstIds={FIRST} />
        </ReactFlow>
      </PassportActions.Provider>
    </div>
  );
}

export default function CallPathDiagram({ diagram, hops, verdictId, selectedHop, moved, onMove, open, setOpen, refit }) {
  const graph = useMemo(() => graphOf(diagram), [diagram]);
  const hop = selectedHop != null ? (hops ?? []).find((h) => h.n === selectedHop) : null;
  const activeStep = stepForHop(diagram, hop);
  return (
    <ReactFlowProvider>
      <Canvas diagram={diagram} graph={graph} hops={hops} verdictId={verdictId} activeStep={activeStep} moved={moved} onMove={onMove} open={open} setOpen={setOpen} refit={refit} />
    </ReactFlowProvider>
  );
}
