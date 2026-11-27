# Talk track

<!-- The source for the Talk track view and the presenter mode. Written once with {{castBrand}}-style tokens; the three vertical packs
     (retail, health, finance) and customer.config.json fill them. A test fails on a token no pack defines. Headings that start with
     "S01:" to "S06:" belong to the story of the same number. Keep every section short enough to say in a minute. -->

## Before you start

You are about to show a client for a PingOne Privilege MCP gateway: the thing an AI agent uses to ask "which tools may I use, and may I use this one?". Say first what is real and what is not. The page banner says the gateway is simulated, and it stays on screen in presenter mode too. In Mock, the gateway, its three doors, the 18 tools, the tokens and every result are produced by this lab, offline, with no tenant and no network. In Real (owner-run, from the lab's own settings) the lab talks to one gateway you configured and shows only what that gateway actually answered, including how many tools the full door lists (the Mock's 18 is the lab's own catalogue; a Real gateway lists whatever its backend offers, so say the number the page shows, not 18).

The story is told for {{castBrand}}, an invented example. The verticals change the words in the stories, not the doors and not the tools.

## What is simulated, and what is not

Simulated in Mock: the gateway and its policy decisions, the MCP handshake, the tool results (invented sample data), the held call, the upstream failure, and the mismatch between a page login and the gateway's identity. Each is labelled simulated where you see it.

Not simulated in the sense of "made up by us": the shape of the conversation. The lab speaks the real MCP wire (initialize, tools/list, tools/call) and shows the exact request and response of every hop.

Never claimed in Real: that the gateway "checked" something. A client sees a status and a body. The lab says "observed" for what it read and "inferred" for what it concluded, and it leaves out the gateway's internal hops because a client cannot see them.

## S01: The door that permits every tool

Pick lab-banking-full and discover. Eighteen tools come back, all of them in the grant of {{castAgentId}}. Run list_entitlements and the verdict is Allowed. Point at the result: it is labelled simulated sample data, not {{castBrand}}'s data.

Then open the movie reel and step through the hops. This is the evidence view: the request, the response and, in Mock, whether the lab's own gateway checked it. Say that the widest door is not the interesting one; it is the baseline you compare the other two against.

## S02: The door that permits some tools

Pick lab-banking-limited and discover. Same client, same call, but now only seven tools come back. The other eleven are not listed, as on the real gateway, for example the tools that guard {{castSensitive}}. Say that a tool missing from the list is still refused if a client asks for it by name.

Run a listed tool: Allowed. Then type sensitive_payroll_details into Run a tool by name: Blocked by policy. The simulated gateway answered 403 before the backend was reached. Say plainly that the refusal is the control working, which is why it is not shown in red, and why the card tells you the next step instead of showing an error.

If you are asked whether a real gateway filters the tool list: on the gateway this lab was checked against, a key with a seven-tool grant was listed exactly those seven, and a call to any other tool was refused with 403. Mock now lists the same way; Real still shows whatever the gateway returns.

## S03: The door with no policy

Pick lab-banking-blocked and discover. Blocked by policy, and no tool list at all. A door with no policy is not an open door; with nothing that permits the caller, the gateway refuses before it lists anything. Try a tool anyway and get the same answer.

If you are asked where a real gateway refuses a door with no policy (at initialize or at tools/list): that is unverified. The lab refuses at initialize and says it is simulated. Ask the audience to capture one from their own gateway if they can.

## S04: A write that waits for a person

On lab-banking-full, run open_ticket, the tool that changes data. The verdict is Held: the simulated gateway is holding {{castTicket}} until {{castApprover}} approves it. Nothing ran.

Be careful here. Held is Mock only. Nobody has captured a real held call yet, so the body you see is invented by this lab and labelled simulated, and Real never claims a hold. Use it to show the idea (a permitted write can still wait for a person), not as a description of how the product answers.

## S05: When the gateway cannot finish

Arm the upstream-error scenario and run list_entitlements. The verdict is Upstream error: a connection problem, not a policy decision. Nothing was refused because nothing answered. The error text is shown in full as JSON, never as a blank page.

Run it again without the scenario and it succeeds, because the fault was one-shot. Ask the audience to say which of the two, a refusal or a failure, they would alert on. They should not be the same alarm.

## S06: Page login is not the identity the gateway evaluated

Choose the identity-mismatch scenario. The page login is demouser; the door's agent key acts as aidemo. The verdict is Allowed, and the identity rail shows both names with a SIMULATED note. The gateway decides on the identity behind the key, not on whoever is signed in to this page.

In Real the lab can only show the identity its own settings declare, because a real 401 or 403 names no identity and a key says nothing about who holds it. That is why the label changes from "Identity the gateway evaluated" to "Identity declared by this lab's settings".

## What to leave with

Three doors, one client, three outcomes: everything, some, nothing. The verdict comes first and it is a word, never only a colour. A refusal is a result. A failure is not a refusal. And a client can only report what it saw, so the evidence view is there to show you exactly that.

## If you are asked

What is verified: the MCP handshake and the shape of requests and responses the lab sends, and that the lab's own tests replay every story and get the verdict the story names. What is not: the exact status and body a real gateway returns for a held call, a filtered tool list, or a door with no policy; the Real sign-in against a live tenant; and anything about product behaviour that is not written down in the lab as measured. Those are marked UNVERIFIED in the repo and the lab does not paper over them.
