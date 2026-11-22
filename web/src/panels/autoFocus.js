// Presenter mode opens the Talk track and the Movie reel BY ITSELF. The shared dialog always moves focus into a dialog that opens, so without this
// the first Escape would close the reel, the second the talk track and only the third would leave presenter mode. A dialog the page opened (not the
// person) gives its focus back: when focus is inside a floating panel, it is released to the page. A dialog the person works in keeps its focus, so
// Escape still closes that dialog first.
export function releaseDialogFocus(doc = typeof document === "undefined" ? null : document) {
  const a = doc?.activeElement;
  if (a && a !== doc.body && typeof a.closest === "function" && a.closest(".fd-panel") && typeof a.blur === "function") { a.blur(); return true; }
  return false;
}
