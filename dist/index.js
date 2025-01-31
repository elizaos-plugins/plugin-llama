// src/services/llama.ts
import { elizaLogger, ServiceType, ModelProviderName } from "@elizaos/core";
import { Service } from "@elizaos/core";
import fs from "fs";
import https from "https";
import { getLlama, LlamaChatSession, LlamaJsonSchemaGrammar } from "node-llama-cpp";
import path from "path";
import si from "systeminformation";
import { fileURLToPath } from "url";
var wordsToPunish = [
  " please",
  " feel",
  " free",
  "!",
  "\u2013",
  "\u2014",
  "?",
  ".",
  ",",
  "; ",
  " cosmos",
  " tapestry",
  " tapestries",
  " glitch",
  " matrix",
  " cyberspace",
  " troll",
  " questions",
  " topics",
  " discuss",
  " basically",
  " simulation",
  " simulate",
  " universe",
  " like",
  " debug",
  " debugging",
  " wild",
  " existential",
  " juicy",
  " circuits",
  " help",
  " ask",
  " happy",
  " just",
  " cosmic",
  " cool",
  " joke",
  " punchline",
  " fancy",
  " glad",
  " assist",
  " algorithm",
  " Indeed",
  " Furthermore",
  " However",
  " Notably",
  " Therefore",
  " Additionally",
  " conclusion",
  " Significantly",
  " Consequently",
  " Thus",
  " What",
  " Otherwise",
  " Moreover",
  " Subsequently",
  " Accordingly",
  " Unlock",
  " Unleash",
  " buckle",
  " pave",
  " forefront",
  " harness",
  " harnessing",
  " bridging",
  " bridging",
  " Spearhead",
  " spearheading",
  " Foster",
  " foster",
  " environmental",
  " impact",
  " Navigate",
  " navigating",
  " challenges",
  " chaos",
  " social",
  " inclusion",
  " inclusive",
  " diversity",
  " diverse",
  " delve",
  " noise",
  " infinite",
  " insanity",
  " coffee",
  " singularity",
  " AI",
  " digital",
  " artificial",
  " intelligence",
  " consciousness",
  " reality",
  " metaverse",
  " virtual",
  " virtual reality",
  " VR",
  " Metaverse",
  " humanity"
];
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var jsonSchemaGrammar = {
  type: "object",
  properties: {
    user: {
      type: "string"
    },
    content: {
      type: "string"
    }
  }
};
var LlamaService = class extends Service {
  constructor() {
    super();
    this.messageQueue = [];
    this.isProcessing = false;
    this.modelInitialized = false;
    this.llama = void 0;
    this.model = void 0;
    this.modelUrl = "https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-8B-GGUF/resolve/main/Hermes-3-Llama-3.1-8B.Q8_0.gguf?download=true";
  }
  async initialize(runtime) {
    const modelName = "model.gguf";
    elizaLogger.info("Initializing LlamaService...");
    this.runtime = runtime;
    this.modelPath = path.join(runtime.getSetting("LLAMALOCAL_PATH").trim() ?? "./", modelName);
    this.ollamaModel = runtime.getSetting("OLLAMA_MODEL");
  }
  async ensureInitialized() {
    if (!this.modelInitialized) {
      elizaLogger.info("Model not initialized, starting initialization...");
      await this.initializeModel();
    } else {
      elizaLogger.info("Model already initialized");
    }
  }
  async initializeModel() {
    try {
      elizaLogger.info("Checking model file...");
      await this.checkModel();
      const systemInfo = await si.graphics();
      const hasCUDA = systemInfo.controllers.some((controller) => controller.vendor.toLowerCase().includes("nvidia"));
      if (hasCUDA) {
        elizaLogger.info("LlamaService: CUDA detected, using GPU acceleration");
      } else {
        elizaLogger.warn("LlamaService: No CUDA detected - local response will be slow");
      }
      elizaLogger.info("Initializing Llama instance...");
      this.llama = await getLlama({
        gpu: hasCUDA ? "cuda" : void 0
      });
      elizaLogger.info("Creating JSON schema grammar...");
      const grammar = new LlamaJsonSchemaGrammar(this.llama, jsonSchemaGrammar);
      this.grammar = grammar;
      elizaLogger.info("Loading model...");
      this.model = await this.llama.loadModel({
        modelPath: this.modelPath
      });
      elizaLogger.info("Creating context and sequence...");
      this.ctx = await this.model.createContext({ contextSize: 8192 });
      this.sequence = this.ctx.getSequence();
      this.modelInitialized = true;
      elizaLogger.success("Model initialization complete");
      this.processQueue();
    } catch (error) {
      elizaLogger.error("Model initialization failed. Deleting model and retrying:", error);
      try {
        elizaLogger.info("Attempting to delete and re-download model...");
        await this.deleteModel();
        await this.initializeModel();
      } catch (retryError) {
        elizaLogger.error("Model re-initialization failed:", retryError);
        throw new Error(`Model initialization failed after retry: ${retryError.message}`);
      }
    }
  }
  async checkModel() {
    if (!fs.existsSync(this.modelPath)) {
      elizaLogger.info("Model file not found, starting download...");
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(this.modelPath);
        let downloadedSize = 0;
        let totalSize = 0;
        const downloadModel = (url) => {
          https.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              elizaLogger.info(`Following redirect to: ${response.headers.location}`);
              downloadModel(response.headers.location);
              return;
            }
            if (response.statusCode !== 200) {
              reject(new Error(`Failed to download model: HTTP ${response.statusCode}`));
              return;
            }
            totalSize = Number.parseInt(response.headers["content-length"] || "0", 10);
            elizaLogger.info(`Downloading model: Hermes-3-Llama-3.1-8B.Q8_0.gguf`);
            elizaLogger.info(`Download location: ${this.modelPath}`);
            elizaLogger.info(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
            response.pipe(file);
            let progressString = "";
            response.on("data", (chunk) => {
              downloadedSize += chunk.length;
              const progress = totalSize > 0 ? (downloadedSize / totalSize * 100).toFixed(1) : "0.0";
              const dots = ".".repeat(Math.floor(Number(progress) / 5));
              progressString = `Downloading model: [${dots.padEnd(20, " ")}] ${progress}%`;
              elizaLogger.progress(progressString);
            });
            file.on("finish", () => {
              file.close();
              elizaLogger.progress("");
              elizaLogger.success("Model download complete");
              resolve();
            });
            response.on("error", (error) => {
              fs.unlink(this.modelPath, () => {
              });
              reject(new Error(`Model download failed: ${error.message}`));
            });
          }).on("error", (error) => {
            fs.unlink(this.modelPath, () => {
            });
            reject(new Error(`Model download request failed: ${error.message}`));
          });
        };
        downloadModel(this.modelUrl);
        file.on("error", (err) => {
          fs.unlink(this.modelPath, () => {
          });
          console.error("File write error:", err.message);
          reject(err);
        });
      });
    } else {
      elizaLogger.warn("Model already exists.");
    }
  }
  async deleteModel() {
    if (fs.existsSync(this.modelPath)) {
      fs.unlinkSync(this.modelPath);
    }
  }
  async queueMessageCompletion(context, temperature, stop, frequency_penalty, presence_penalty, max_tokens) {
    await this.ensureInitialized();
    return new Promise((resolve, reject) => {
      this.messageQueue.push({
        context,
        temperature,
        stop,
        frequency_penalty,
        presence_penalty,
        max_tokens,
        useGrammar: true,
        resolve,
        reject
      });
      this.processQueue();
    });
  }
  async queueTextCompletion(context, temperature, stop, frequency_penalty, presence_penalty, max_tokens) {
    await this.ensureInitialized();
    return new Promise((resolve, reject) => {
      this.messageQueue.push({
        context,
        temperature,
        stop,
        frequency_penalty: frequency_penalty ?? 1,
        presence_penalty: presence_penalty ?? 1,
        max_tokens,
        useGrammar: false,
        resolve,
        reject
      });
      this.processQueue();
    });
  }
  async processQueue() {
    if (this.isProcessing || this.messageQueue.length === 0 || !this.modelInitialized) {
      return;
    }
    this.isProcessing = true;
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        try {
          const response = await this.getCompletionResponse(message.context, message.temperature, message.stop, message.frequency_penalty, message.presence_penalty, message.max_tokens, message.useGrammar);
          message.resolve(response);
        } catch (error) {
          message.reject(error);
        }
      }
    }
    this.isProcessing = false;
  }
  async completion(prompt, runtime) {
    try {
      await this.initialize(runtime);
      if (runtime.modelProvider === ModelProviderName.OLLAMA) {
        return await this.ollamaCompletion(prompt);
      }
      return await this.localCompletion(prompt);
    } catch (error) {
      elizaLogger.error("Error in completion:", error);
      throw error;
    }
  }
  async embedding(text, runtime) {
    try {
      await this.initialize(runtime);
      if (runtime.modelProvider === ModelProviderName.OLLAMA) {
        return await this.ollamaEmbedding(text);
      }
      return await this.localEmbedding(text);
    } catch (error) {
      elizaLogger.error("Error in embedding:", error);
      throw error;
    }
  }
  async getCompletionResponse(context, temperature, stop, frequency_penalty, presence_penalty, max_tokens, useGrammar) {
    context = context += "\nIMPORTANT: Escape any quotes in any string fields with a backslash so the JSON is valid.";
    const ollamaModel = process.env.OLLAMA_MODEL;
    if (ollamaModel) {
      const ollamaUrl = process.env.OLLAMA_SERVER_URL || "http://localhost:11434";
      elizaLogger.info(`Using Ollama API at ${ollamaUrl} with model ${ollamaModel}`);
      const response2 = await fetch(`${ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          prompt: context,
          stream: false,
          options: {
            temperature,
            stop,
            frequency_penalty,
            presence_penalty,
            num_predict: max_tokens
          }
        })
      });
      if (!response2.ok) {
        throw new Error(`Ollama request failed: ${response2.statusText}`);
      }
      const result = await response2.json();
      return useGrammar ? { content: result.response } : result.response;
    }
    if (!this.sequence) {
      throw new Error("Model not initialized.");
    }
    const session = new LlamaChatSession({
      contextSequence: this.sequence
    });
    const wordsToPunishTokens = wordsToPunish.flatMap((word) => this.model.tokenize(word));
    const repeatPenalty = {
      punishTokensFilter: () => wordsToPunishTokens,
      penalty: 1.2,
      frequencyPenalty: frequency_penalty,
      presencePenalty: presence_penalty
    };
    const response = await session.prompt(context, {
      onTextChunk(chunk) {
        process.stdout.write(chunk);
      },
      temperature: Number(temperature),
      repeatPenalty
    });
    if (!response) {
      throw new Error("Response is undefined");
    }
    if (useGrammar) {
      let jsonString = response.match(/```json(.*?)```/s)?.[1].trim();
      if (!jsonString) {
        try {
          jsonString = JSON.stringify(JSON.parse(response));
        } catch {
          throw new Error("JSON string not found");
        }
      }
      try {
        const parsedResponse = JSON.parse(jsonString);
        if (!parsedResponse) {
          throw new Error("Parsed response is undefined");
        }
        await this.sequence.clearHistory();
        return parsedResponse;
      } catch (error) {
        elizaLogger.error("Error parsing JSON:", error);
      }
    } else {
      await this.sequence.clearHistory();
      return response;
    }
  }
  async getEmbeddingResponse(input) {
    const ollamaModel = process.env.OLLAMA_MODEL;
    if (ollamaModel) {
      const ollamaUrl2 = process.env.OLLAMA_SERVER_URL || "http://localhost:11434";
      const embeddingModel2 = process.env.OLLAMA_EMBEDDING_MODEL || "mxbai-embed-large";
      elizaLogger.info(`Using Ollama API for embeddings with model ${embeddingModel2} (base: ${ollamaModel})`);
      const response2 = await fetch(`${ollamaUrl2}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: embeddingModel2,
          prompt: input
        })
      });
      if (!response2.ok) {
        throw new Error(`Ollama embeddings request failed: ${response2.statusText}`);
      }
      const result = await response2.json();
      return result.embedding;
    }
    if (!this.sequence) {
      throw new Error("Sequence not initialized");
    }
    const ollamaUrl = process.env.OLLAMA_SERVER_URL || "http://localhost:11434";
    const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL || "mxbai-embed-large";
    elizaLogger.info(`Using Ollama API for embeddings with model ${embeddingModel} (base: ${this.ollamaModel})`);
    const response = await fetch(`${ollamaUrl}/api/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input,
        model: embeddingModel
      })
    });
    if (!response.ok) {
      throw new Error(`Failed to get embedding: ${response.statusText}`);
    }
    const embedding = await response.json();
    return embedding.vector;
  }
  async ollamaCompletion(prompt) {
    const ollamaModel = process.env.OLLAMA_MODEL;
    const ollamaUrl = process.env.OLLAMA_SERVER_URL || "http://localhost:11434";
    elizaLogger.info(`Using Ollama API at ${ollamaUrl} with model ${ollamaModel}`);
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        prompt,
        stream: false,
        options: {
          temperature: 0.7,
          stop: ["\n"],
          frequency_penalty: 0.5,
          presence_penalty: 0.5,
          num_predict: 256
        }
      })
    });
    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.statusText}`);
    }
    const result = await response.json();
    return result.response;
  }
  async ollamaEmbedding(text) {
    const ollamaModel = process.env.OLLAMA_MODEL;
    const ollamaUrl = process.env.OLLAMA_SERVER_URL || "http://localhost:11434";
    const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL || "mxbai-embed-large";
    elizaLogger.info(`Using Ollama API for embeddings with model ${embeddingModel} (base: ${ollamaModel})`);
    const response = await fetch(`${ollamaUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: embeddingModel,
        prompt: text
      })
    });
    if (!response.ok) {
      throw new Error(`Ollama embeddings request failed: ${response.statusText}`);
    }
    const result = await response.json();
    return result.embedding;
  }
  async localCompletion(prompt) {
    if (!this.sequence) {
      throw new Error("Sequence not initialized");
    }
    const tokens = this.model.tokenize(prompt);
    const wordsToPunishTokens = wordsToPunish.flatMap((word) => this.model.tokenize(word));
    const repeatPenalty = {
      punishTokens: () => wordsToPunishTokens,
      penalty: 1.2,
      frequencyPenalty: 0.5,
      presencePenalty: 0.5
    };
    const responseTokens = [];
    for await (const token of this.sequence.evaluate(tokens, {
      temperature: 0.7,
      repeatPenalty,
      yieldEogToken: false
    })) {
      const current = this.model.detokenize([...responseTokens, token]);
      if (current.includes("\n")) {
        elizaLogger.info("Stop sequence found");
        break;
      }
      responseTokens.push(token);
      process.stdout.write(this.model.detokenize([token]));
      if (responseTokens.length > 256) {
        elizaLogger.info("Max tokens reached");
        break;
      }
    }
    const response = this.model.detokenize(responseTokens);
    if (!response) {
      throw new Error("Response is undefined");
    }
    await this.sequence.clearHistory();
    return response;
  }
  async localEmbedding(text) {
    if (!this.sequence) {
      throw new Error("Sequence not initialized");
    }
    const embeddingContext = await this.model.createEmbeddingContext();
    const embedding = await embeddingContext.getEmbeddingFor(text);
    return embedding?.vector ? [...embedding.vector] : void 0;
  }
};
LlamaService.serviceType = ServiceType.TEXT_GENERATION;

// src/index.ts
var imagePlugin = {
  name: "default",
  description: "Default plugin, with basic actions and evaluators",
  services: [new LlamaService()],
  actions: []
};
var index_default = imagePlugin;
export {
  index_default as default
};
//# sourceMappingURL=index.js.map