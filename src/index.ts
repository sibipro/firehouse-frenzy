import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
export interface Env {
	WEBSOCKET_SERVER: DurableObjectNamespace<WebSocketServer>;
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
			const coords = await addressToCoords(address);
			stub.broadcast({ coords });
			return new Response(null, { status: 204 });
		}

		if (request.url.endsWith('/websocket')) {
			// Expect to receive a WebSocket Upgrade request.
			// If there is one, accept the request and return a WebSocket Response.
			const upgradeHeader = request.headers.get('Upgrade');
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				return new Response('Durable Object expected Upgrade: websocket', { status: 426 });
			}

			// This example will refer to the same Durable Object,
			// since the name "foo" is hardcoded.
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
			// The constructor may have been called when waking up from hibernation,
			// so get previously serialized metadata for any existing WebSockets.
			this.sessions.add(webSocket);
		});
	}

	async fetch(request: Request): Promise<Response> {
		// Creates two ends of a WebSocket connection.
		// if a request is a post, it's a webhook.
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		// Calling `accept()` tells the runtime that this WebSocket is to begin terminating
		// request within the Durable Object. It has the effect of "accepting" the connection,
		// and allowing the WebSocket to send and receive messages.
		server.accept();
		this.sessions.add(server);
		// If the client closes the connection, the runtime will close the connection too.
		server.addEventListener('close', (cls: CloseEvent) => {
			server.close(cls.code, 'Durable Object is closing WebSocket');
			this.sessions.delete(server);
		});

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	// broadcast() broadcasts a message to all clients.
	broadcast(message) {
		// Apply JSON if we weren't given a string to start with.
		if (typeof message !== 'string') {
			message = JSON.stringify(message);
		}

		this.sessions.forEach((session, webSocket) => {
			try {
				webSocket.send(message);
			} catch (err) {
				this.sessions.delete(webSocket);
			}
		});

		return new Response(null, { status: 204 });
	}
}

const addressToCoords = async (address: string) => {
	const coord = await fetch(`https://nominatim.openstreetmap.org/search.php?q=${address}&format=jsonv2`, {
		headers: {
			'User-Agent': 'sibi-firehouse-frenzy',
		},
	});
	const parsed = nominatimSchema.parse(await coord.json());
	return {
		lat: parsed[0].lat,
		lon: parsed[0].lon,
	};
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
