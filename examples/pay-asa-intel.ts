/**
 * Call the FrostyFi "ASA Safety Intelligence" x402 agent on Algorand MainNet.
 *
 *   npm run quote -- 31566704   # show the price (HTTP 402), pays nothing
 *   npm run pay -- 31566704     # pay 0.01 USDC and print the safety report
 *
 * The paying account needs USDC (ASA 31566704) only. The GoPlausible facilitator
 * pays the Algorand fee, and the agent settles the payment only after the run
 * succeeds.
 */
import { seedFromMnemonic } from '@algorandfoundation/algokit-utils/algo25';
import { AlgorandClient } from '@algorandfoundation/algokit-utils/algorand-client';
import { ed25519SigningKeyFromWrappedSecret, type WrappedEd25519Seed } from '@algorandfoundation/algokit-utils/crypto';
import { ExactAvmScheme, toClientAvmSigner } from '@x402/avm';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';

const ENDPOINT = process.env.ENDPOINT ?? 'https://x402.frostylabs.ai/asa-intel/a2a';

// Payments settle after the workflow finishes. algokit-utils signs payments that
// are valid for 10 rounds (~30 s) by default, which a longer run can outlive, so
// allow 20 rounds (~60 s, the agent's advertised maxTimeoutSeconds).
const VALIDITY_WINDOW_ROUNDS = 20;

function requestBody(assetId: string): string {
	return JSON.stringify({
		jsonrpc: '2.0',
		id: 1,
		method: 'message/send',
		params: { message: { role: 'user', parts: [{ data: { assetId } }] } },
	});
}

/** base64(32-byte seed || 32-byte public key), the format toClientAvmSigner expects. */
async function privateKeyBase64(): Promise<string> {
	if (process.env.AVM_PRIVATE_KEY) return process.env.AVM_PRIVATE_KEY;
	const mnemonic = process.env.ALGORAND_MNEMONIC;
	if (!mnemonic) throw new Error('Set ALGORAND_MNEMONIC or AVM_PRIVATE_KEY (see .env.example)');

	const seed = seedFromMnemonic(mnemonic);
	// Copy BEFORE deriving: ed25519SigningKeyFromWrappedSecret zeroes the seed
	// buffer after use, and a zeroed seed silently derives the well-known
	// all-zeros account instead of yours.
	const seedCopy = new Uint8Array(seed);
	const wrapped: WrappedEd25519Seed = {
		unwrapEd25519Seed: async () => seed,
		wrapEd25519Seed: async () => {},
	};
	const key = await ed25519SigningKeyFromWrappedSecret(wrapped);
	return Buffer.concat([Buffer.from(seedCopy), Buffer.from(key.ed25519Pubkey)]).toString('base64');
}

async function quote(assetId: string): Promise<void> {
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: requestBody(assetId),
	});
	const header = res.headers.get('payment-required');
	console.log(`HTTP ${res.status}`);
	if (!header) {
		console.log(await res.text());
		return;
	}
	const challenge = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
	const [terms] = challenge.accepts;
	console.log(JSON.stringify({ resource: challenge.resource, accepts: terms }, null, 2));
}

async function pay(assetId: string): Promise<void> {
	const signer = toClientAvmSigner(await privateKeyBase64());
	const algorandClient = AlgorandClient.mainNet().setDefaultValidityWindow(VALIDITY_WINDOW_ROUNDS);
	const client = new x402Client();
	// "algorand:*" matches both the full and the truncated CAIP-2 network ids.
	client.register('algorand:*', new ExactAvmScheme(signer, { algorandClient }));
	const fetchWithPay = wrapFetchWithPayment(fetch, client);

	const started = Date.now();
	const res = await fetchWithPay(ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: requestBody(assetId),
	});
	console.log(`HTTP ${res.status} in ${((Date.now() - started) / 1000).toFixed(1)}s (payer ${signer.address})`);

	const receipt = res.headers.get('payment-response');
	if (receipt) {
		const settle = JSON.parse(Buffer.from(receipt, 'base64').toString('utf8'));
		console.log('settlement:', JSON.stringify(settle));
		if (settle.transaction) console.log(`explorer: https://allo.info/tx/${settle.transaction}`);
	}

	const body = (await res.json()) as {
		result?: { status?: { state?: string; message?: { parts?: Array<{ text?: string }> } } };
		error?: unknown;
	};
	if (!body.result) {
		console.log(JSON.stringify(body, null, 2));
		return;
	}
	console.log('state:', body.result.status?.state);
	const text = body.result.status?.message?.parts?.[0]?.text;
	if (text) {
		try {
			console.log(JSON.stringify(JSON.parse(text), null, 2));
		} catch {
			console.log(text);
		}
	}
}

const args = process.argv.slice(2);
const assetId = args.find((a) => /^\d+$/.test(a)) ?? '31566704';
(args.includes('--quote') ? quote(assetId) : pay(assetId)).catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
