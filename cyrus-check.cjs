const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  const requests = [];
  const storage = new Map();
  let offline = false;
  let tokens = ['A thoughtful answer.'];
  const web = { needsGrounding: () => false, retrieveGrounding: async () => null, formatGroundingContext: (value) => value.context };
  const context = vm.createContext({
    console, AbortController, TextDecoder, Response, performance,
    window: { setTimeout, clearTimeout },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, init = {}) => {
      if (offline) throw new Error('Test endpoint offline');
      if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'nomic-embed-text' }, { name: 'qwen2.5:3b' }] });
      const body = JSON.parse(init.body);
      requests.push({ url, body });
      return new Response(tokens.map((content) => JSON.stringify({ message: { content } }) + '\n').join(''));
    },
  });
  function load(file, deps) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
      .replaceAll('import.meta.env.DEV', 'false').replaceAll('import.meta.hot', 'undefined');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    const run = vm.runInContext(`(function(require, exports) { ${compiled}\n})`, context, { filename: file });
    run((name) => {
      assert.ok(name in deps, `Unexpected dependency ${name}`);
      return deps[name];
    }, exports);
    return exports;
  }
  const ai = load('src/lib/ai.ts', { './web': web });
  const module = load('src/lib/cyrus.ts', {
    react: { useSyncExternalStore() {} }, './ai': ai, './web': web,
    './knowledge': { knowledgeContext: () => '' },
  });
  return { ...module, ai, requests, storage, setOffline: (value) => { offline = value; }, setTokens: (value) => { tokens = value; } };
}

async function turn(cyrus, text) {
  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`Turn timed out: ${text}`)); }, 2000);
    const unsubscribe = cyrus.subscribe(() => {
      if (cyrus.snapshot().phase === 'off' && cyrus.snapshot().log.at(-1)?.who === 'cyrus') {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
  cyrus.submit(text);
  await finished;
}

async function main() {
  const h = harness();
  const chat = [
    'I love music', 'Recommend some music for studying', 'Tell me a ghost story',
    'Explain how an engine works', 'Can you help me debug my computer?',
    'I am stuck on a maths problem', 'How can I restart my career?',
    'Open source software is interesting', 'Give me an exit strategy for my startup',
    'Who was Cyrus the Great?', 'What is the weather in Tokyo?',
    'How does rain form?', 'What is service design?', 'Why do cats purr?',
    'I think Scotch is adorable', 'Tell me about Mario games',
    'Write a Python function that opens a door', 'What is my best lap telling me about my driving?',
    'Hi, how are you?', 'Thanks, explain that in more detail', 'Help me plan a trip',
    'What time is it in Tokyo?', 'Never mind the car, explain gravity',
    'Do not open the door', 'I want to learn about hydraulic lifts',
    'Play a song in Python using a sine wave', 'Stop listening is a common voice command',
    'Describe the trophy design', 'What do you think about AI?', 'Why?',
    'Give me an example', 'Continue', 'Write a poem about rain', 'Who are you?',
    'Hello', 'Thanks', 'How are you', 'Can you explain racing lines?',
  ];
  for (const text of chat) assert.equal(h.parseIntent(text).kind, 'ask', text);
  const commands = [
    ['Hi Scotch', 'pet'], ['hello Mario', 'pet'], ['bring the dog to me', 'pet'],
    ['Scotch come here', 'pet'], ['open the door', 'door'], ['close the garage door', 'door'],
    ['Could you please open the door?', 'door'], ['lower the lift', 'lift'],
    ['raise the car', 'lift'], ['start service', 'service'], ['stop service', 'service'],
    ['rev the engine', 'rev'], ['rev the bike', 'rev'], ['take a photo', 'photo'],
    ["let's take the car", 'drive'], ['take the bike out', 'drive'], ['go to the circuit', 'drive'],
    ['back to the garage', 'garage'], ['stop driving', 'exit'], ['exit the garage', 'exit'],
    ['restart the race', 'restart'], ['recover', 'recover'], ['race my ghost', 'ghost'],
    ['hide the racing line', 'line'], ['show the racing line', 'line'], ['what is my best lap', 'bestLap'],
    ['open the computer', 'panel'], ['show me the trophies', 'panel'], ['start launch practice', 'panel'],
    ['play music', 'music'], ['stop music', 'music'], ['turn the radio off', 'music'],
    ['make it rain', 'weather'], ['stop rain', 'weather'], ['make it night', 'weather'],
    ['make it daytime', 'weather'], ['sound off', 'sound'], ['replay entry', 'replay'],
    ['systems check', 'status'], ['sit down', 'sit'], ['what time is it', 'time'],
    ["what's the date", 'date'], ['stop listening', 'off'], ['go to sleep', 'sleep'], ['stop', 'stop'],
  ];
  for (const [text, kind] of commands) assert.equal(h.parseIntent(text).kind, kind, text);
  assert.equal(h.parseIntent('stop music').on, false);
  assert.equal(h.parseIntent('lower the lift').up, false);
  assert.equal(h.parseIntent('make it daytime').night, false);
  assert.equal(h.splitWake('Who was Cyrus the Great?').woke, false);
  assert.equal(h.splitWake('Hey Cyrus, explain gravity').rest, 'explain gravity');

  await turn(h.cyrus, 'I love music');
  const initial = h.requests.at(-1).body;
  assert.match(initial.messages[0].content, /general-purpose AI companion/);
  assert.doesNotMatch(initial.messages[0].content, /COMPUTER USE:|a race engineer who has seen everything|At most one short witty line/);
  assert.equal(initial.messages.filter((message) => message.content === 'I love music').length, 1);
  assert.equal(initial.model, 'qwen2.5:3b');
  assert.equal(initial.options.num_ctx, 8192);
  assert.equal(initial.options.num_predict, 1200);
  assert.match(h.cyrus.snapshot().brain, /qwen2.5:3b/);
  assert.equal(h.cyrus.on, false);

  h.cyrus.setHandler((intent) => intent.kind === 'door' ? 'Door open.' : null);
  await turn(h.cyrus, 'open the door');
  await turn(h.cyrus, 'Why do I enjoy it?');
  const conversation = h.requests.at(-1).body.messages;
  assert.ok(conversation.some((message) => message.content === 'I love music'));
  assert.ok(conversation.some((message) => message.content === 'Door open.'));
  assert.equal(conversation.at(-1).content, 'Why do I enjoy it?');

  h.setTokens(['Here is the code. ', '```py\nprint("hello. ', 'world")\n```', '\nIt prints a greeting.']);
  await turn(h.cyrus, 'Write a short Python greeting');
  assert.match(h.cyrus.snapshot().reply, /print\("hello\. world"\)/);
  assert.doesNotMatch(h.cyrus.spoken, /print\(|hello\. world/);
  assert.match(h.cyrus.spoken, /It prints a greeting/);

  await h.ai.streamChat({ settings: { ...h.ai.DEFAULT_SETTINGS, provider: 'ollama' }, messages: [], onToken() {}, signal: new AbortController().signal });
  assert.match(h.requests.at(-1).body.messages[0].content, /COMPUTER USE:/);
  assert.equal(h.requests.at(-1).body.options.num_ctx, 4096);

  const offline = harness();
  offline.setOffline(true);
  await turn(offline.cyrus, 'Can we talk about my day?');
  assert.match(offline.cyrus.snapshot().reply, /isn't connected/);
  assert.equal(offline.requests.length, 0);
  offline.setOffline(false);
  await turn(offline.cyrus, 'Can we try again?');
  assert.equal(offline.requests.length, 1);

  const selected = harness();
  selected.storage.set('apex.settings.v1', JSON.stringify({ ...selected.ai.DEFAULT_SETTINGS, provider: 'ollama', model: 'missing-model' }));
  await turn(selected.cyrus, 'Hello');
  assert.equal(selected.requests.at(-1).body.model, 'qwen2.5:3b');

  const cancelled = harness();
  cancelled.cyrus.submit('Explain gravity');
  cancelled.cyrus.submit('stop');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled.cyrus.snapshot().phase, 'off');
  assert.equal(cancelled.requests.length, 0);
  assert.equal(cancelled.cyrus.snapshot().reply, '');

  for (let i = 0; i < 40; i++) h.cyrus.pushLog(i % 2 ? 'cyrus' : 'you', 'x'.repeat(1000));
  assert.ok(h.cyrus.history.length <= 24);
  assert.ok(h.cyrus.history.reduce((size, message) => size + message.content.length, 0) <= 12000);
  assert.equal(h.cyrus.history[0].role, 'user');
  console.log(`CYRUS: ${chat.length} conversation routes, ${commands.length} commands, wake parsing, context, prompts, code speech, model discovery, offline recovery and cancellation passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
