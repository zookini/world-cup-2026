import { proxyUpstream } from "./_proxy.js";

export const onRequest = (context) =>
  proxyUpstream(context, "https://worldcup26.ir/get/groups");
