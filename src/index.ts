
import { LlamaService } from "./services/llama";

const imagePlugin = {
  name: "default",
  description: "Default plugin, with basic actions and evaluators",
  services: [new LlamaService() as any],
  actions: [],
}; 

export default imagePlugin;
