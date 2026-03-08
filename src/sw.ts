/// <reference lib="webworker" />

const SW_VERSION = 'v1';

self.addEventListener('install', () => {
    (self as any).skipWaiting();
});

self.addEventListener('activate', (event: any) => {
    event.waitUntil((self as any).clients.claim());
});

self.addEventListener('fetch', (event: any) => {
    const url = new URL(event.request.url);

    if (url.pathname === '/api/generate' && event.request.method === 'POST') {
        event.respondWith(handleGenerateRequest(event.request));
    }
});

async function handleGenerateRequest(request: Request) {
    const body = await request.json();
    const prompt = body.prompt;

    // We need to communicate with the main thread or the worker
    // Since SW doesn't have access to the UI worker directly, 
    // we use the clients.matchAll() to find the active window and ask it to generate
    const clients = await (self as any).clients.matchAll();
    const client = clients[0]; // Take the first active client

    if (!client) {
        return new Response(JSON.stringify({ error: 'No active agent found' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
            if (event.data.error) {
                resolve(new Response(JSON.stringify({ error: event.data.error }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                }));
            } else {
                resolve(new Response(JSON.stringify({ response: event.data.text }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                }));
            }
        };

        client.postMessage({
            type: 'API_GENERATE_REQUEST',
            prompt: prompt
        }, [channel.port2]);
    });
}
