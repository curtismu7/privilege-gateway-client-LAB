import { validateDiagram } from "./diagramSchema.js";

// The diagrams are diagram-studio/1 data files in <repo>/diagrams/ (rule 17), loaded by name. The page builds the ReactFlow graph from this data
// and nothing is hand-built in code: no node and no edge exists in a .jsx file (a test fails on one). Bundled into the web build by Vite.
const FILES = import.meta.glob("../../../diagrams/*.json", { eager: true, import: "default" });
const BY_NAME = new Map(Object.entries(FILES).map(([path, data]) => [path.split("/").pop().replace(/\.json$/, ""), data]));

export const diagramNames = () => [...BY_NAME.keys()];

/** The data itself when it is a valid diagram-studio/1 diagram, else null (an invalid file is never drawn). */
export const checked = (data) => (data && validateDiagram(data).length === 0 ? data : null);

/** The diagram called `name`, or null when there is none or the file is not a valid diagram-studio/1 diagram. */
export function loadDiagram(name) {
  return checked(typeof name === "string" ? BY_NAME.get(name) : undefined);
}
