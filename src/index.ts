import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
export interface Env {
	WEBSOCKET_SERVER: DurableObjectNamespace<WebSocketServer>;
}

// Worker
export default {
	async fetch(request, env, ctx): Promise<Response> {
		if (request.method === 'POST') {
			const id = env.WEBSOCKET_SERVER.idFromName('foo');
			const stub = env.WEBSOCKET_SERVER.get(id);
			const body = await request.json();
			const parsed = firehoseSchema.parse(body);
			const address = formatAddress(parsed.data.propertyAddress);
			const coords = await addressToCoords(address);
			stub.broadcast({ address, coords });
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

		return new Response(null, {
			status: 400,
			statusText: 'Bad Request',
			headers: {
				'Content-Type': 'text/plain',
			},
		});
	},
};

// Durable Object
export class WebSocketServer extends DurableObject {
	currentlyConnectedWebSockets: number;
	sessions: Set<WebSocket>;
	state: DurableObjectState;
	constructor(ctx: DurableObjectState, env: Env) {
		// This is reset whenever the constructor runs because
		// regular WebSockets do not survive Durable Object resets.
		//
		// WebSockets accepted via the Hibernation API can survive
		// a certain type of eviction, but we will not cover that here.
		super(ctx, env);
		this.currentlyConnectedWebSockets = 0;
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
		this.currentlyConnectedWebSockets += 1;

		// Send welcome message to the newly connected client
		server.send(`Welcome! You are client #${this.currentlyConnectedWebSockets}`);

		// Upon receiving a message from the client, the server replies with the same message,
		// and the total number of connections with the "[Durable Object]: " prefix
		server.addEventListener('message', (event: MessageEvent) => {
			server.send(`[Durable Object] currentlyConnectedWebSockets: ${this.currentlyConnectedWebSockets}`);
		});
		this.sessions.add(server);
		// If the client closes the connection, the runtime will close the connection too.
		server.addEventListener('close', (cls: CloseEvent) => {
			this.currentlyConnectedWebSockets -= 1;
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
	const coordJson = (await coord.json()) as string;
	console.log(coordJson);
	return coordJson;
};

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
