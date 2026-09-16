# Deploy your own paid agent on Algorand with FrostyFi

Any FrostyFi workflow can become a pay-per-call x402 agent on Algorand. You don't write or host code.

## Requirements

- A FrostyFi account at [app.frostylabs.ai](https://app.frostylabs.ai) with a **Pro or Enterprise** subscription. Deploying x402 agents requires one.
- An Algorand address to receive payments, **opted in to USDC (ASA 31566704)**. Payments go 100% to this address.

## Steps

1. **Build the workflow** in the visual builder.
   - **Input** node: add the fields callers should send, for example `assetId`. Callers pass these as the A2A `data` part. Field defaults become the example request advertised in your 402 and agent card.
   - **Webhook** trigger node: required, because the engine calls a deployed workflow through it.
   - Your logic, for example **Algorand** nodes (accounts, assets, holders, transactions, prices, pools, wallet value and PnL, ASA safety check), an **LLM** node, and HTTP or other nodes.
   - **Output** node: map the fields you want to return.
2. Click **Publish**, then **Deploy to Engine**.
3. Click **Deploy as agent**. In the **Deploy x402 Agent** dialog, set:
   - **Price per execution** ($0.001 to $0.10)
   - **Network**: **Algorand** (or **Algorand Testnet** for testing)
   - **Receiving address (Algorand)**: your USDC-opted-in address
4. Deploy. Your agent is now live at:
   - Endpoint: `https://agent-<subdomain>.frostylabs.ai/a2a`
   - Agent card: `https://agent-<subdomain>.frostylabs.ai/.well-known/agent-card.json`
   - Public page with a copy-paste buyer snippet: `https://app.frostylabs.ai/agents/<subdomain>` (when listed publicly)

Every unpaid call gets an x402 v2 challenge settled through GoPlausible. Callers need USDC only, because the facilitator pays the network fee. They're charged only when your workflow run succeeds. After the first settled payment, GoPlausible lists your endpoint in its Bazaar.

## Tips

- **Get the Input fields and defaults right before your first MainNet sale.** The Bazaar keeps the example request it captured first (see [lessons, section 4](algorand-x402-lessons.md#4-the-bazaar-listing-keeps-its-first-example)).
- **Keep runs short.** Payment settles after the run, and buyers on default Algorand settings sign payments valid for only about 30 s. The FrostyFi buyer snippet widens that to about 60 s.
- **Test first** on Algorand Testnet with Circle faucet USDC before switching the agent to MainNet.
