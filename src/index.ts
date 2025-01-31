
import { describeImage } from "./actions/describe-image";
import { LlamaService } from "./services/llama";

const imagePlugin = {
  name: "default",
  description: "Default plugin, with basic actions and evaluators",
  services: [new LlamaService() as any],
  actions: [describeImage],
}; 

export default imagePlugin;
