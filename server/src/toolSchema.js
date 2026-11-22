// A tool's own input schema, as the gateway lists it. Real mode builds the Tools-tab form and the agent's tool definitions from it, so
// an argument name always comes from the tool itself, never from the lab's Mock samples. The schema is gateway data: it is size-capped,
// and only plain JSON Schema shapes are read from it.

const MAX_SCHEMA_BYTES = 16 * 1024;
const MAX_PROPS = 32;
// The Anthropic API's tool-name rule. A listed tool whose name does not fit is not offered to the model (the Tools tab still shows it).
export const MODEL_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// -> a plain { type: 'object', properties, required } or null when the schema is missing, oversized or not an object schema.
export function cleanSchema(schema) {
  if (!isObj(schema)) return null;
  let size;
  try { size = JSON.stringify(schema).length; } catch { return null; }
  if (size > MAX_SCHEMA_BYTES) return null;
  if (schema.type !== undefined && schema.type !== 'object') return null;
  const props = isObj(schema.properties) ? Object.entries(schema.properties).filter(([k, v]) => /^[A-Za-z0-9_.-]{1,64}$/.test(k) && isObj(v)).slice(0, MAX_PROPS) : [];
  const properties = Object.fromEntries(props);
  const required = Array.isArray(schema.required) ? schema.required.filter((k) => typeof k === 'string' && k in properties) : [];
  // Shared definitions stay with the properties, so a property's $ref still resolves in the definition the model gets.
  const defs = Object.fromEntries(['$defs', 'definitions'].filter((k) => isObj(schema[k])).map((k) => [k, schema[k]]));
  return { type: 'object', properties, required, ...defs };
}

// A starting value for one property: its default, its first example, a quoted `e.g. "..."` from its description, else an empty value of its type.
function startValue(p) {
  if (p.default !== undefined) return p.default;
  if (Array.isArray(p.examples) && p.examples.length) return p.examples[0];
  if (Array.isArray(p.enum) && p.enum.length) return p.enum[0];
  const eg = /e\.g\.\s*"([^"]{1,80})"/.exec(String(p.description ?? ''));
  if (eg && (p.type === undefined || p.type === 'string')) return eg[1];
  switch (p.type) {
    case 'number': case 'integer': return 0;
    case 'boolean': return false;
    case 'array': return [];
    case 'object': return {};
    default: return '';
  }
}

// -> { args, required } for the form, or null when the tool lists no usable schema.
export function formFromSchema(schema) {
  const s = cleanSchema(schema);
  if (!s) return null;
  return { args: Object.fromEntries(Object.entries(s.properties).map(([k, p]) => [k, startValue(p)])), required: [...s.required] };
}

// -> an Anthropic tool definition, or null when the name does not fit the API's rule. A tool with no usable schema takes an empty object.
export function modelToolFrom(tool) {
  if (!tool || !MODEL_TOOL_NAME.test(String(tool.name ?? ''))) return null;
  const s = cleanSchema(tool.inputSchema) ?? { type: 'object', properties: {}, required: [] };
  return { name: tool.name, description: String(tool.description ?? '').slice(0, 1024), input_schema: s };
}
