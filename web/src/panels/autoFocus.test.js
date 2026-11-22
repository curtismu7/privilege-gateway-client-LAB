import { describe, expect, test } from "vitest";
import { releaseDialogFocus } from "./autoFocus.js";

describe("releaseDialogFocus", () => {
  test("releases focus held inside a floating panel, and leaves focus anywhere else alone", () => {
    document.body.innerHTML = '<div class="fd-panel" tabindex="-1"><button id="in">in</button></div><button id="out">out</button>';
    document.getElementById("in").focus();
    expect(document.activeElement.id).toBe("in");
    expect(releaseDialogFocus()).toBe(true);
    expect(document.activeElement).toBe(document.body);
    document.getElementById("out").focus();
    expect(releaseDialogFocus()).toBe(false);
    expect(document.activeElement.id).toBe("out");
    expect(releaseDialogFocus()).toBe(false);
  });
});
