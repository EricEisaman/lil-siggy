import { pipeline, env } from '@huggingface/transformers';

// Configuration for Transformers.js v4
env.allowLocalModels = false;
env.useBrowserCache = true;

const SYSTEM_PROMPT = `You are a helpful AI assistant.
Follow this loop for reasoning and tool calling:
- Thought: Describe your reasoning.
- Action: Output a structured JSON tool call like {"name": "calculator", "arguments": {"expression": "2+2"}} or if you have the final answer, prefix it with "Final Answer:".

Available tools:
- calculator: { expression: string } - Solve math expressions.
- weather: { city: string } - Get current weather for a city.
- sentiment: { text: string } - Analyze the sentiment of a piece of text.

Example:
User: What is 2+2?
Thought: I need to calculate 2+2.
Action: {"name": "calculator", "arguments": {"expression": "2+2"}}
Observation: 4
Thought: I have the result.
Action: Final Answer: The result is 4.`;

const pipelines: Record<string, any> = {};
let hfToken: string | null = null;

async function getPipeline(task: any, model: string, options: any = {}) {
    const key = `${task}:${model}`;
    if (pipelines[key]) return pipelines[key];

    self.postMessage({ type: 'status', message: `Initializing ${model} (${task})...` });

    const pipelineOptions = {
        device: 'webgpu',
        ...options,
        progress_callback: (data: any) => {
            if (data.status === 'progress') {
                self.postMessage({
                    type: 'progress',
                    progress: data.progress.toFixed(1),
                    file: data.file,
                    model: model
                });
            }
        }
    };

    if (hfToken) {
        (pipelineOptions as any).token = hfToken;
    }

    try {
        pipelines[key] = await pipeline(task, model, pipelineOptions);
        self.postMessage({ type: 'status', message: `${model} ready!` });
        self.postMessage({ type: 'model-ready', model: task });
        return pipelines[key];
    } catch (error) {
        console.error(`Failed to load model ${model}:`, error);
        self.postMessage({ type: 'status', message: `Error loading model: ${model}` });
        throw error;
    }
}

self.onmessage = async (e) => {
    const { messages, type, text, token } = e.data;

    if (token) {
        hfToken = token;
        console.log('HF token received in worker');
    }

    if (type === 'load') {
        // Pre-load primary model
        // Switching to the official repo as requested by user
        await getPipeline('text-generation', 'HuggingFaceTB/SmolLM-1.7B-Instruct', { dtype: 'q4' });
        return;
    }

    if (type === 'sentiment') {
        const sentimentModel = await getPipeline('sentiment-analysis', 'xenova/distilbert-base-uncased-finetuned-sst-2-english');
        const result = await sentimentModel(text);
        self.postMessage({ type: 'sentiment-result', result, originalText: text });
        return;
    }

    if (type === 'generate') {
        const model = await getPipeline('text-generation', 'HuggingFaceTB/SmolLM-1.7B-Instruct', { dtype: 'q4' });

        // Format prompt for SmolLM
        let prompt = `<|im_start|>system\n${SYSTEM_PROMPT}<|im_end|>\n`;
        for (const msg of messages) {
            if (msg.role === 'user') {
                prompt += `<|im_start|>user\n${msg.content}<|im_end|>\n<|im_start|>assistant\n`;
            } else if (msg.role === 'assistant') {
                prompt += `${msg.content}<|im_end|>\n`;
            } else if (msg.role === 'tool') {
                prompt += `Observation: ${msg.content}\n`;
            }
        }

        const output = await model(prompt, {
            max_new_tokens: 256,
            temperature: 0.2,
            repetition_penalty: 1.1,
            do_sample: false,
            on_token_callback: (beams: any) => {
                const decoded = model.tokenizer.decode(beams[0].output_token_ids, { skip_special_tokens: true });
                const newText = decoded.replace(prompt, '');
                self.postMessage({ type: 'stream', text: newText });
            }
        });

        const fullOutput = output[0].generated_text.replace(prompt, '');
        self.postMessage({ type: 'done', text: fullOutput });
    }
};
