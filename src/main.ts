import { executeTool } from './tools';

interface Message {
    role: 'user' | 'assistant' | 'tool';
    content: string;
}

class RalphAgent {
    private worker: Worker;
    private chatHistory: Message[] = [];
    private onStatus: (status: string) => void;
    private onProgress: (progress: number, visible: boolean) => void;
    private onStream: (text: string) => void;
    private onMessage: (msg: Message) => void;
    private onActiveModel: (model: string) => void;

    constructor(callbacks: {
        onStatus: (s: string) => void,
        onProgress: (p: number, v: boolean) => void,
        onStream: (t: string) => void,
        onMessage: (m: Message) => void,
        onActiveModel: (m: string) => void
    }) {
        this.onStatus = callbacks.onStatus;
        this.onProgress = callbacks.onProgress;
        this.onStream = callbacks.onStream;
        this.onMessage = callbacks.onMessage;
        this.onActiveModel = callbacks.onActiveModel;

        // Initialize Web Worker using Vite's worker import
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

        this.worker.onmessage = (e) => {
            const { type, text, message, progress, file, model } = e.data;
            if (type === 'status') {
                this.onStatus(message);
                if (message === 'Model loaded!') this.onProgress(100, false);
            }
            if (type === 'progress') {
                this.onProgress(parseFloat(progress), true);
                this.onStatus(`Loading: ${progress}% (${file})`);

                const statusId = model?.includes('SmolLM') ? 'status-gen' : 'status-sentiment';
                const statusEl = document.getElementById(statusId);
                if (statusEl) {
                    statusEl.innerText = `${progress}%`;
                    statusEl.className = 'model-status status-loading';
                }
            }
            if (type === 'model-ready') {
                const statusId = e.data.model === 'text-generation' ? 'status-gen' : 'status-sentiment';
                const statusEl = document.getElementById(statusId);
                if (statusEl) {
                    statusEl.innerText = 'Ready';
                    statusEl.className = 'model-status status-ready';
                }
            }
            if (type === 'stream') this.onStream(text);
        };

        this.loadHistory();

        // Trigger early load with token if present
        const savedToken = localStorage.getItem('hf_token');
        this.worker.postMessage({ type: 'load', token: savedToken });
    }

    setToken(token: string) {
        this.worker.postMessage({ token });
    }

    private loadHistory() {
        const saved = localStorage.getItem('ralph_chat_history');
        if (saved) {
            this.chatHistory = JSON.parse(saved);
            this.chatHistory.forEach(msg => this.onMessage(msg));
        }
    }

    private saveHistory() {
        localStorage.setItem('ralph_chat_history', JSON.stringify(this.chatHistory));
    }

    async runLoop(userInput: string, externalPort?: MessagePort) {
        const userMsg: Message = { role: 'user', content: userInput };
        this.chatHistory.push(userMsg);
        if (!externalPort) this.onMessage(userMsg);
        this.saveHistory();

        let loopCount = 0;
        const maxLoops = 5;

        while (loopCount < maxLoops) {
            loopCount++;

            const responsePromise = new Promise<{ type: string, text?: string, result?: any }>((resolve) => {
                const handler = (e: MessageEvent) => {
                    if (e.data.type === 'done' || e.data.type === 'sentiment-result') {
                        this.worker.removeEventListener('message', handler);
                        resolve(e.data);
                    }
                };
                this.worker.addEventListener('message', handler);
            });

            this.worker.postMessage({ type: 'generate', messages: this.chatHistory });
            const messageData = await responsePromise;

            if (messageData.type === 'done') {
                const rawOutput = messageData.text!;
                // Parse Ralph patterns: Thought: ... Action: ...
                const actionMatch = rawOutput.match(/Action:\s*(\{.*\})/s) || rawOutput.match(/Action:\s*(Final Answer:.*)/s);

                if (!actionMatch) {
                    const finalMsg: Message = { role: 'assistant', content: rawOutput };
                    this.chatHistory.push(finalMsg);
                    if (!externalPort) this.onMessage(finalMsg);
                    else externalPort.postMessage({ text: rawOutput });
                    this.saveHistory();
                    return;
                }

                const actionContent = actionMatch[1].trim();

                if (actionContent.startsWith('Final Answer:')) {
                    const answer = actionContent.replace('Final Answer:', '').trim();
                    const finalMsg: Message = { role: 'assistant', content: answer };
                    this.chatHistory.push(finalMsg);
                    if (!externalPort) this.onMessage(finalMsg);
                    else externalPort.postMessage({ text: answer });
                    this.saveHistory();
                    return;
                }

                // Try to parse JSON tool call
                try {
                    const toolCall = JSON.parse(actionContent);
                    let result: string;

                    if (toolCall.name === 'sentiment') {
                        // Asynchronous tool call to worker
                        this.onActiveModel('DistilBERT');
                        const sentimentPromise = new Promise<string>((resolve) => {
                            const handler = (e: MessageEvent) => {
                                if (e.data.type === 'sentiment-result') {
                                    this.worker.removeEventListener('message', handler);
                                    const res = e.data.result[0];
                                    resolve(`Sentiment: ${res.label} (score: ${res.score.toFixed(2)})`);
                                }
                            };
                            this.worker.addEventListener('message', handler);
                        });

                        this.worker.postMessage({ type: 'sentiment', text: toolCall.arguments.text });
                        result = await sentimentPromise;
                    } else {
                        result = executeTool(toolCall);
                    }

                    // Show the thinking/action in UI as assistant message
                    const thoughtPart = rawOutput.split('Action:')[0].trim();
                    const internalMsg: Message = { role: 'assistant', content: `${thoughtPart}\n\n**Tool Call**: \`${toolCall.name}\`\n**Observation**: ${result}` };
                    if (!externalPort) this.onMessage(internalMsg);

                    this.chatHistory.push({ role: 'assistant', content: rawOutput });
                    this.chatHistory.push({ role: 'tool', content: result });
                } catch (e) {
                    console.error("Failed to parse tool call", e);
                    const errorMsg: Message = { role: 'assistant', content: "Error parsing tool call. " + rawOutput };
                    this.chatHistory.push(errorMsg);
                    if (!externalPort) this.onMessage(errorMsg);
                    else externalPort.postMessage({ error: 'Tool parsing error' });
                    return;
                }
            }
        }
    }
}

// UI Initialization
document.addEventListener('DOMContentLoaded', () => {
    // const app = document.getElementById('app')!;
    const chatOutput = document.getElementById('chat-output')!;
    const userInput = document.getElementById('user-input') as HTMLTextAreaElement;
    const sendBtn = document.getElementById('send-btn')!;
    const statusEl = document.getElementById('status')!;

    const appendMessage = (msg: Message) => {
        const div = document.createElement('div');
        div.className = `message message-${msg.role === 'user' ? 'user' : 'assistant'}`;

        // Very basic markdown-ish display
        const content = msg.content
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/`(.*?)`/g, '<code>$1</code>');

        div.innerHTML = content;
        chatOutput.appendChild(div);
        chatOutput.scrollTop = chatOutput.scrollHeight;
    };

    const progressContainer = document.getElementById('progress-container')!;
    const progressBar = document.getElementById('progress-bar')!;

    const dashboard = document.getElementById('model-dashboard')!;
    const dashboardToggle = document.getElementById('dashboard-toggle')!;
    const activeModelTag = document.getElementById('active-model-tag')!;
    const activeModelName = document.getElementById('active-model-name')!;
    const hfTokenInput = document.getElementById('hf-token') as HTMLInputElement;
    const saveTokenBtn = document.getElementById('save-token')!;
    const tokenForm = document.getElementById('token-form') as HTMLFormElement;

    // Load saved token
    const savedToken = localStorage.getItem('hf_token');
    if (savedToken) {
        hfTokenInput.value = savedToken;
    }

    dashboardToggle.onclick = () => {
        dashboard.style.display = dashboard.style.display === 'none' ? 'block' : 'none';
    };

    tokenForm.onsubmit = (e) => {
        e.preventDefault();
        const token = hfTokenInput.value.trim();
        localStorage.setItem('hf_token', token);
        agent.setToken(token);
        saveTokenBtn.innerText = 'Saved!';
        setTimeout(() => saveTokenBtn.innerText = 'Save', 2000);
    };

    const updateActiveModel = (modelName: string) => {
        activeModelTag.style.display = 'inline-block';
        activeModelName.innerText = modelName;

        const genStatus = document.getElementById('status-gen')!;
        const sentStatus = document.getElementById('status-sentiment')!;

        if (modelName === 'SmolLM-1.7B') {
            genStatus.className = 'model-status status-active';
            if (sentStatus.className.includes('status-active')) sentStatus.className = 'model-status status-ready';
        } else if (modelName === 'DistilBERT') {
            sentStatus.className = 'model-status status-active';
            if (genStatus.className.includes('status-active')) genStatus.className = 'model-status status-ready';
        }
    };

    const agent = new RalphAgent({
        onStatus: (s) => statusEl.innerText = s,
        onProgress: (p, v) => {
            progressContainer.style.display = v ? 'block' : 'none';
            progressBar.style.width = `${p}%`;
        },
        onStream: (_t) => {
            // Optional: Implement streaming preview in the UI
        },
        onMessage: (m) => appendMessage(m),
        onActiveModel: (m) => updateActiveModel(m)
    });

    const handleSend = async () => {
        const text = userInput.value.trim();
        if (!text) return;
        userInput.value = '';
        userInput.disabled = true;
        (sendBtn as HTMLButtonElement).disabled = true;

        updateActiveModel('SmolLM-1.7B');
        await agent.runLoop(text);
        activeModelTag.style.display = 'none';

        const genStatus = document.getElementById('status-gen')!;
        if (genStatus.className.includes('status-active')) genStatus.className = 'model-status status-ready';

        userInput.disabled = false;
        (sendBtn as HTMLButtonElement).disabled = false;
        userInput.focus();
    };

    sendBtn.onclick = handleSend;
    userInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // Register Service Worker for local API
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register(new URL('./sw.ts', import.meta.url), { type: 'module' })
            .then(reg => console.log('Service Worker registered', reg))
            .catch(err => console.error('Service Worker registration failed', err));

        navigator.serviceWorker.addEventListener('message', async (event) => {
            if (event.data.type === 'API_GENERATE_REQUEST') {
                const port = event.ports[0];
                updateActiveModel('SmolLM-1.7B');
                console.log('Intercepted API request for:', event.data.prompt);
                await agent.runLoop(event.data.prompt, port);
                activeModelTag.style.display = 'none';
            }
        });
    }
});
