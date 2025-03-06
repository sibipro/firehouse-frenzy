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
		console.log(`Received ${request.method} request to ${request.url}`);

		if (request.method === 'POST') {
			console.log('Processing POST request');
			const id = env.WEBSOCKET_SERVER.idFromName('foo');
			const stub = env.WEBSOCKET_SERVER.get(id);
			const body = await request.json();
			console.log('Received body:', body);
			const parsed = firehoseSchema.parse(body);
			console.log('Parsed data:', parsed);
			const address = formatAddress(parsed.data.propertyAddress);
			console.log('Formatted address:', address);
			const coords = await addressToCoords(address, env);
			console.log('Retrieved coordinates:', coords);

			await stub.fetch('https://internal/broadcast', {
				method: 'POST',
				body: JSON.stringify({ coords }),
			});

			return new Response(null, { status: 204 });
		}

		if (request.url.endsWith('/websocket')) {
			console.log('Processing WebSocket upgrade request');
			const upgradeHeader = request.headers.get('Upgrade');
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				console.log('Invalid upgrade header:', upgradeHeader);
				return new Response('Durable Object expected Upgrade: websocket', { status: 426 });
			}

			let id = env.WEBSOCKET_SERVER.idFromName('foo');
			let stub = env.WEBSOCKET_SERVER.get(id);
			console.log('Created WebSocket stub with ID:', id);

			return stub.fetch(request);
		}
		console.log('Falling back to ASSETS fetch');
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
		console.log('WebSocketServer constructor called');
		this.state.getWebSockets().forEach((webSocket) => {
			console.log('Restoring existing WebSocket connection');
			this.sessions.add(webSocket);
		});
	}

	async fetch(request: Request) {
		console.log('WebSocketServer: Processing fetch request');

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
		console.log(`New WebSocket connection established. Total connections: ${this.sessions.size}`);

		server.addEventListener('close', (cls: CloseEvent) => {
			console.log(`WebSocket connection closed with code ${cls.code}`);
			server.close(cls.code, 'Durable Object is closing WebSocket');
			this.sessions.delete(server);
			console.log(`WebSocket connection removed. Total connections: ${this.sessions.size}`);
		});

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	broadcast(message) {
		console.log('Broadcasting message:', message);
		if (typeof message !== 'string') {
			message = JSON.stringify(message);
			console.log('Stringified message:', message);
		}

		this.sessions.forEach((webSocket) => {
			try {
				webSocket.send(message);
				console.log('Message sent successfully to WebSocket');
			} catch (err) {
				console.error('Error sending message to WebSocket:', err);
				this.sessions.delete(webSocket);
				console.log(`Failed WebSocket removed. Total connections: ${this.sessions.size}`);
			}
		});

		return new Response(null, { status: 204 });
	}
}

const addressToCoords = async (address: string, env: Env) => {
	console.log('Looking up coordinates for address:', address);
	const coordFromKv = await env.FIREHOUSE_FRENZY.get(address);
	if (coordFromKv) {
		console.log('Found coordinates in KV:', coordFromKv);
		return JSON.parse(coordFromKv);
	}
	console.log('Coordinates not found in KV, fetching from OpenStreetMap');
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
	console.log('Retrieved coordinates from OpenStreetMap:', coords);
	await env.FIREHOUSE_FRENZY.put(address, JSON.stringify(coords));
	console.log('Stored coordinates in KV');
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
