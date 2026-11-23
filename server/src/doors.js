// The doors and the tools: configuration, in one place. Nothing else in the server names a door or a tool.
// Door and tool names are the approved neutral names. Descriptions and sample arguments follow the design mock.
// Everything here is Mock data: Real doors come from the lab's own .env (PGC_GW_APPS), and Real tool lists come from the gateway.

// grant: 'all' = every tool, an array = exactly those tools, null = no policy (the gateway refuses every caller).
const READ_ONLY = [
  'list_entitlements', 'who_has_role', 'get_access_grants', 'get_portfolio_summary',
  'get_investment_accounts', 'get_investment_balance', 'get_investment_transactions',
];

export const DOORS = Object.freeze([
  { id: 'lab-banking-full', description: 'Every tool: all 18 listed and permitted.', policy: 'lab-banking-full', grant: 'all' },
  { id: 'lab-banking-limited', description: '7 read-only tools listed; the other 11 are not listed, and a call to one is refused.', policy: 'lab-banking-limited', grant: READ_ONLY },
  { id: 'lab-banking-blocked', description: 'No policy, so the gateway refuses every caller.', policy: null, grant: null },
]);

// sample = the invented data a simulated allowed call returns. hitl = the approval policy a write waits on (Mock only).
const T = (name, description, args, required, sample, extra = {}) => ({ name, description, args, required, sample, ...extra });
export const TOOLS = Object.freeze([
  T('list_entitlements', 'Entitlements held by a person.', { user: 'carol.nguyen' }, ['user'], { user: { id: 'carol.nguyen', found: true }, entitlements: [{ resource: 'prod-db-primary', role: 'prod-db-admin' }, { resource: 'payments-api', role: 'payments-deployer' }] }),
  T('who_has_role', 'People who hold a given role.', { role: 'prod-db-admin' }, ['role'], { role: 'prod-db-admin', holders: [{ user: 'alice.chen', resource: 'prod-db-primary' }, { user: 'carol.nguyen', resource: 'prod-db-primary' }] }),
  T('get_access_grants', 'Every grant on one resource, with its tier and owner.', { resource: 'prod-db-primary' }, ['resource'], { resource: 'prod-db-primary', tier: 'critical', owner: 'alice.chen', grants: [{ user: 'alice.chen', role: 'prod-db-admin' }, { user: 'carol.nguyen', role: 'prod-db-admin' }] }),
  T('open_ticket', 'Open an access-review ticket to revoke, grant, or flag for review. This changes data.', { user: 'carol.nguyen', resource: 'prod-db-primary', action: 'review', justification: 'Quarterly access review' }, ['user', 'resource', 'action', 'justification'], { ticket: 'tkt_0001', state: 'open' }, { write: true, hitl: 'hitl-open-ticket' }),
  T('get_portfolio_summary', 'Holdings and value of a portfolio.', { portfolio_id: 'pf_3301' }, ['portfolio_id'], { portfolio_id: 'pf_3301', positions: 12, value: 'invented sample' }),
  T('get_investment_accounts', 'Investment accounts on the profile.', { customer_id: 'cus_7781' }, ['customer_id'], { customer_id: 'cus_7781', accounts: ['inv_5520', 'inv_5521'] }),
  T('get_investment_balance', 'Current balance of an investment account.', { account_id: 'inv_5520' }, ['account_id'], { account_id: 'inv_5520', balance: 'invented sample', currency: 'USD' }),
  T('get_investment_transactions', 'Recent transactions on an investment account.', { account_id: 'inv_5520', limit: 3, since: '2026-10-01' }, ['account_id'], { account_id: 'inv_5520', transactions: [{ id: 'tx_1', kind: 'buy' }, { id: 'tx_2', kind: 'sell' }, { id: 'tx_3', kind: 'dividend' }] }),
  T('sensitive_patient_records', 'Access highly sensitive patient health records.', { patient_id: 'pat_4410' }, ['patient_id'], { record: 'invented sample' }),
  T('sensitive_order_history', 'Access the customer’s sensitive order and purchase history.', { customer_id: 'cus_7781' }, ['customer_id'], { record: 'invented sample' }),
  T('sensitive_membership_details', 'Access the customer’s sensitive membership details.', { customer_id: 'cus_7781' }, ['customer_id'], { record: 'invented sample' }),
  T('sensitive_payroll_details', 'Access the employee’s sensitive payroll details.', { employee_id: 'emp_2209' }, ['employee_id'], { record: 'invented sample' }),
  T('sensitive_tax_record', 'Access the sensitive tax assessment record.', { taxpayer_id: 'tp_8812' }, ['taxpayer_id'], { record: 'invented sample' }),
  T('sensitive_student_finance', 'Access the student’s sensitive financial aid record.', { student_id: 'stu_3307' }, ['student_id'], { record: 'invented sample' }),
  T('sensitive_supplier_contract', 'Access the sensitive supplier contract terms.', { supplier_id: 'sup_1190' }, ['supplier_id'], { record: 'invented sample' }),
  T('sensitive_holdings', 'Access sensitive investment holdings with cost-basis detail.', { account_id: 'inv_5520' }, ['account_id'], { record: 'invented sample' }),
  T('sensitive_passenger_record', 'Access the sensitive passenger record.', { passenger_id: 'pax_6021' }, ['passenger_id'], { record: 'invented sample' }),
  T('sensitive_customer_identity', 'Access the customer’s identity-verification (KYC) record.', { customer_id: 'cus_7781' }, ['customer_id'], { record: 'invented sample' }),
]);

// The page-login user of the Mock identity-mismatch scenario, and the identity the Mock gateway evaluates.
export const MOCK_IDENTITY = Object.freeze({ name: 'aidemo', email: 'aidemo@example.com' });
export const MOCK_PAGE_LOGIN = Object.freeze({ name: 'demouser', email: 'demouser@example.com' });

// Mock-only scenarios. 'none' is the normal run.
export const SCENARIOS = Object.freeze(['none', 'no-key', 'bad-key', 'upstream-error', 'identity-mismatch']);

const doorMap = new Map(DOORS.map((d) => [d.id, d]));
const toolMap = new Map(TOOLS.map((t) => [t.name, t]));
export const doorById = (id) => (typeof id === 'string' ? doorMap.get(id) : undefined);
export const toolByName = (name) => (typeof name === 'string' ? toolMap.get(name) : undefined);

export function isPermitted(door, toolName) {
  if (!door || !toolMap.has(toolName)) return false;
  return door.grant === 'all' || (Array.isArray(door.grant) && door.grant.includes(toolName));
}
export const grantedTools = (door) => TOOLS.filter((t) => isPermitted(door, t.name)).map((t) => t.name);

// A door name as the lab accepts it from the browser: the shape only. Whether the door exists is decided against the
// active door list (Mock: DOORS; Real: PGC_GW_APPS).
export const DOOR_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

// The environment variable suffix and the shared client's caller id for a door: lab-banking-full -> lab_banking_full.
export const callerIdFor = (doorId) => String(doorId).replace(/-/g, '_').toLowerCase();

// Sample arguments for a tool name the lab knows (UI help only; a Real tool the lab does not know has none).
export const sampleArgsFor = (name) => structuredClone(toolByName(name)?.args ?? {});
