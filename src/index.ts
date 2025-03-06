import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
export interface Env {
	WEBSOCKET_SERVER: DurableObjectNamespace<WebSocketServer>;
	FIREHOUSE_FRENZY: KVNamespace;
	ASSETS: any;
}

// Worker
export default {
	async fetch(request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method === 'POST') {
			const id = env.WEBSOCKET_SERVER.idFromName('foo');
			const stub = env.WEBSOCKET_SERVER.get(id);
			const body = await request.json();
			const parsed = firehoseSchema.parse(body);
			const address = formatAddress(parsed.data.propertyAddress);
			const coords = await addressToCoords(address, env);

			await stub.fetch('https://internal/broadcast', {
				method: 'POST',
				body: JSON.stringify({ coords }),
			});

			return new Response(null, { status: 204 });
		}

		if (request.url.endsWith('/websocket')) {
			const upgradeHeader = request.headers.get('Upgrade');
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				return new Response('Durable Object expected Upgrade: websocket', { status: 426 });
			}

			let id = env.WEBSOCKET_SERVER.idFromName('foo');
			let stub = env.WEBSOCKET_SERVER.get(id);

			return stub.fetch(request);
		}
		return env.ASSETS.fetch(request);
	},
};

// Durable Object
export class WebSocketServer extends DurableObject {
	sessions: Set<WebSocket>;
	state: DurableObjectState;
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sessions = new Set();
		this.state = ctx;
		this.state.getWebSockets().forEach((webSocket) => {
			this.sessions.add(webSocket);
		});
	}

	async fetch(request: Request) {
		const url = new URL(request.url);
		if (url.pathname === '/broadcast') {
			const message = await request.json();
			return this.broadcast(message);
		}

		// WebSocket connection handling
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		server.accept();
		this.sessions.add(server);

		server.addEventListener('close', (cls: CloseEvent) => {
			server.close(cls.code, 'Durable Object is closing WebSocket');
			this.sessions.delete(server);
		});

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	broadcast(message) {
		if (typeof message !== 'string') {
			message = JSON.stringify(message);
		}

		this.sessions.forEach((webSocket) => {
			try {
				webSocket.send(message);
			} catch (err) {
				this.sessions.delete(webSocket);
			}
		});

		return new Response(null, { status: 204 });
	}
}

const addressToCoords = async (address: string, env: Env) => {
	const coordFromKv = await env.FIREHOUSE_FRENZY.get(address);
	if (coordFromKv) {
		return JSON.parse(coordFromKv);
	}
	const coord = await fetch(`https://nominatim.openstreetmap.org/search.php?q=${address}&format=jsonv2`, {
		headers: {
			'User-Agent': 'sibi-firehouse-frenzy',
		},
	});
	const parsed = nominatimSchema.parse(await coord.json());
	const coords = {
		lat: parsed[0].lat,
		lon: parsed[0].lon,
	};
	await env.FIREHOUSE_FRENZY.put(address, JSON.stringify(coords));
	return coords;
};

const nominatimSchema = z.array(
	z.object({
		lat: z.string(),
		lon: z.string(),
	})
);

const firehoseSchema = z.object({
	data: z.object({
		propertyAddress: z.object({
			line1: z.string(),
			line2: z.string().optional(),
			city: z.string(),
			stateOrProvince: z.string(),
			postalCode: z.string(),
		}),
	}),
});

type FirehoseMessage = z.infer<typeof firehoseSchema>;

const formatAddress = (address: FirehoseMessage['data']['propertyAddress']): string => {
	return [address.line1, address.line2, address.city, address.stateOrProvince, address.postalCode].filter(Boolean).join(' ');
};
