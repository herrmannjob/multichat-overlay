import { KickFlow } from "@gbrlstr/kick-flow";

export async function initKick(emit) {
  const channel = process.env.KICK_CHANNEL;
  if (!channel) {
    console.log('[kick] no KICK_CHANNEL provided; skipping.');
    return;
  }

  const client = new KickFlow({ clientId: process.env.KICK_CLIENT_ID, clientSecret: process.env.KICK_CLIENT_SECRET });
  const chatWS = await client.chat.connectToChatByChannel(channel);

  chatWS.on('message', msg => {
    emit({
      platform: 'kick',
      author: msg.sender.username,
      text: msg.content,
      color: null,
      badges: [],
      avatar: null
    });
  });

  await chatWS.connect();
  console.log('[kick] connected (via kick-flow) to', channel);
}
