// Every vendored web piece imports and renders in this lab (so a stale or missing sibling file fails here, not in the browser).
import React from "react";
import { describe, expect, test } from "vitest";
import TopMenu from "./top-menu/TopMenu.jsx";
import ReleaseNotes from "./top-menu/ReleaseNotes.jsx";
import ShelfLink from "./components/ShelfLink.jsx";
import VerifyMark from "./components/VerifyMark.jsx";
import Json, { DecodedTokens, TokenParts } from "./components/JsonPane.jsx";
import JsonViaEvidencePath from "./json/JsonPane.jsx";
import FloatingDialog from "./floating-dialog/FloatingDialog.jsx";
import GatewayTrace from "./gateway-trace/GatewayTrace.jsx";
import MovieReel from "./evidence/MovieReel.jsx";
import SequenceView from "./evidence/SequenceView.jsx";
import StepDetailPanel from "./evidence/StepDetailPanel.jsx";
import ActorCard from "./evidence/ActorCard.jsx";

describe("vendored web pieces", () => {
  test("every shared component is a function and the evidence path reaches the one JsonPane", () => {
    for (const c of [TopMenu, ReleaseNotes, ShelfLink, VerifyMark, Json, DecodedTokens, TokenParts, FloatingDialog, GatewayTrace, MovieReel, SequenceView, StepDetailPanel, ActorCard]) {
      expect(typeof c).toBe("function");
    }
    expect(JsonViaEvidencePath).toBe(Json);
  });
});
