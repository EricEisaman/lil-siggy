import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        target: 'esnext'
    },
    worker: {
        format: 'es',
        plugins: () => [] // Ensure no conflicting plugins in worker
    },
    optimizeDeps: {
        exclude: ['@huggingface/transformers']
    },
    server: {
        headers: {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin',
        }
    }
});
