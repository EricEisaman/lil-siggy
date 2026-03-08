export interface ToolCall {
    name: string;
    arguments: Record<string, any>;
}

export const tools = {
    calculator: {
        description: "Solve math expressions. Provide the expression as a string.",
        parameters: {
            type: "object",
            properties: {
                expression: { type: "string" }
            },
            required: ["expression"]
        }
    },
    weather: {
        description: "Get current weather for a city. Provide the city name.",
        parameters: {
            type: "object",
            properties: {
                city: { type: "string" }
            },
            required: ["city"]
        }
    },
    sentiment: {
        description: "Analyze the sentiment of a piece of text. Returns positive or negative.",
        parameters: {
            type: "object",
            properties: {
                text: { type: "string" }
            },
            required: ["text"]
        }
    }
};

export function executeTool(call: ToolCall): string {
    console.log(`Executing tool: ${call.name}`, call.arguments);
    switch (call.name) {
        case 'calculator':
            try {
                // Use Function constructor for simple safe math eval (browser native)
                const expression = call.arguments.expression.replace(/[^0-9+\-*/().\s]/g, ''); // Basic sanitization
                const result = new Function(`return ${expression}`)();
                return `Result: ${result}`;
            } catch (e) {
                return `Error evaluating expression: ${e instanceof Error ? e.message : String(e)}`;
            }
        case 'weather':
            const city = call.arguments.city || "unknown";
            const temp = Math.floor(Math.random() * 30);
            const conditions = ["Sunny", "Cloudy", "Rainy", "Partly Cloudy"][Math.floor(Math.random() * 4)];
            return `Current weather in ${city}: ${temp}°C, ${conditions}.`;
        default:
            return `Tool ${call.name} not found.`;
    }
}
