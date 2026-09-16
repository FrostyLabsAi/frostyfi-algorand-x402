# ASA Safety Intelligence: API reference

A paid x402 agent that turns any Algorand Standard Asset (ASA) id into a structured risk report.

| | |
|---|---|
| Endpoint | `POST https://x402.frostylabs.ai/asa-intel/a2a` |
| Agent card | https://x402.frostylabs.ai/asa-intel/.well-known/agent-card.json |
| Protocol | A2A JSON-RPC `message/send`, paid with x402 v2 |
| Price | 0.01 USDC per successful call (ASA 31566704, Algorand MainNet) |
| Facilitator | [GoPlausible](https://facilitator.goplausible.xyz), which pays the network fee |
| Merchant | `frostyfi.algo` (`CXFBDEPZS4A3E5KCZCT4FE2SGRAOXR4PHUP3Z5434BVCRYPLHDTUMTNSRU`) |

## Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [{ "data": { "assetId": "31566704" } }]
    }
  }
}
```

`assetId` is a string holding the numeric ASA id. Send it as a `data` part. A plain `text` part does not carry the field, and the run fails without charging you.

## Payment flow

1. POST without payment. You get **HTTP 402**. The base64 `PAYMENT-REQUIRED` header, which the body repeats, holds the x402 v2 terms: `scheme: exact`, `network: algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=`, `amount: 10000`, `asset: 31566704`, `payTo`, `maxTimeoutSeconds: 60`, and `extra.feePayer`.
2. Sign the payment group with an x402 client and POST again with the `PAYMENT-SIGNATURE` header. [`examples/pay-asa-intel.ts`](../examples/pay-asa-intel.ts) does both steps.
3. The agent verifies the payment with GoPlausible, runs the workflow, and **settles only if the run succeeded**. The receipt comes back in the `PAYMENT-RESPONSE` header (base64 JSON with `success`, `transaction`, `network`, `payer`).

Settlement happens after the run, so sign the payment with a validity window of at least 20 rounds (about 60 s). See [algorand-x402-lessons.md](algorand-x402-lessons.md#2-payment-validity-window-vs-charge-on-success).

## Response

A completed A2A task. The report is a JSON string in the first text part:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "id": "…",
    "status": {
      "state": "completed",
      "message": { "role": "agent", "parts": [{ "text": "{\"report\":{…}}" }] }
    }
  }
}
```

### Report schema

| Field | Type | Meaning |
|---|---|---|
| `summary` | string | What the asset is and its main risks, with numbers |
| `safetyScore` | integer 1–10 | 10 is safest |
| `flags[]` | `{ flag, meaning }` | Each verdict flag that fired, explained in context |
| `liquidity.assessment` | string | Depth and activity across DEX pools |
| `liquidity.poolCount` | number | Liquidity pools found for the asset |
| `liquidity.volumeTrend30d` | string | 30-day volume trend |
| `recommendation` | string | Practical guidance for holders and traders |

### Verdict flags

| Flag | Fires when |
|---|---|
| `CLAWBACK_ACTIVE` | A clawback address is set, so the issuer can pull tokens back from holders |
| `FREEZE_ACTIVE` | A freeze address is set, so the issuer can freeze holdings |
| `MANAGER_ACTIVE` | A manager address is set, so the issuer can change the asset's control addresses |
| `DEFAULT_FROZEN` | New holdings start frozen |
| `CONCENTRATED_SUPPLY` | One holder has more than 50% of circulating supply (reserve excluded) |
| `NO_PRICE` | No market price was found |
| `HOLDER_DATA_PARTIAL` | The large-holder query failed and concentration came from a partial page |

The report explains flags in context. A regulated issuer such as Circle keeps freeze and manager rights on USDC, and that doesn't mean the asset is a scam.

### Example (goBTC, ASA 386192725, live call on 2026-09-16)

Settlement tx [`3MMAKRNR…YBKA`](https://allo.info/tx/3MMAKRNR3UZAYOA32HUT5TH3H4QMYTEZY2PWPIC6ATSZPQZRYBKA), 17.4 s end to end.

```json
{
  "report": {
    "summary": "goBTC is the wrapped Bitcoin asset bridged via Algomint on Algorand. Clawback and freeze privileges are disabled, leaving only manager authority active for potential metadata or reserve address updates. The supply of ~28.88 goBTC is moderately concentrated with the top holder holding 47.33% (likely a bridge reserve, lending pool, or major DEX), and 12 holders controlling over 1% each.",
    "safetyScore": 8,
    "flags": [
      {
        "flag": "MANAGER_ACTIVE",
        "meaning": "The asset manager address is populated, permitting administrative updates to asset configuration parameters, typical for bridged synthetic tokens."
      }
    ],
    "liquidity": {
      "assessment": "Robust ecosystem integration across 69 liquidity pools, though DEX total value locked is modest at ~2.26 goBTC (~1.89M ALGO equivalent). Daily volume is consistent with active swap counts ranging from hundreds to thousands daily.",
      "poolCount": 69,
      "volumeTrend30d": "Fluctuating between 0.0079 and 1.13 goBTC per day, with recent trading normalizing near 0.06 to 0.12 goBTC daily."
    },
    "recommendation": "Acceptable for trading and DeFi usage with standard exposure to Algomint bridge custodial backing and smart contract risks. Avoid single-transaction market buys exceeding available pool depth to prevent severe slippage."
  }
}
```

## How the report is built

The agent is a FrostyFi workflow ([`workflows/asa-safety-intelligence.json`](../workflows/asa-safety-intelligence.json)):

1. **ASA Safety Check** (Algorand node): asset parameters from the Nodely indexer, reserve holding from algod, holders above 1% of circulating supply, and spot price and confidence from Vestige.
2. **Price History** (Algorand node): 30 daily candles of volume, TVL, swaps and VWAP from Vestige.
3. **Liquidity Pools** (Algorand node): pool count from Vestige.
4. **Safety Report** (LLM node, Gemini Flash via OpenRouter): writes the strict-JSON report from the data above.

## Errors

| Situation | Result | Charged |
|---|---|---|
| No payment, or a probe body that isn't JSON-RPC | HTTP 402 with payment terms | No |
| Invalid payment (bad signature, wrong amount, insufficient USDC) | HTTP 402 | No |
| Run fails (for example an unknown asset id or a missing `assetId`) | Task `state: failed` with the error text | No, settlement is skipped |
| Payment expired before settlement | HTTP 402 `Payment settlement failed; result withheld` | No, the transaction is dead on-chain |
