export function buildMessages({ mode, text = '', images = [], context = '', systemPrompt }) {
  const system = { role: 'system', content: systemPrompt };
  const userParts = [];
  if (text) userParts.push({ type: 'text', text });
  if (context) userParts.push({ type: 'text', text: `Context: ${context}` });
  for (const img of images) {
    userParts.push({ type: 'image_url', image_url: { url: img } });
  }
  const user = { role: 'user', content: userParts.length > 0 ? userParts : [{ type: 'text', text: 'Please analyze the situation.' }] };
  return [system, user];
}