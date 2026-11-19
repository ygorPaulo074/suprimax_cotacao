// jest-environment-jsdom não expõe Request, Response, Headers e fetch do Node, que o roteador de
// dados do react-router usa em cada navegação (createClientSideRequest).
// eslint-disable-next-line @typescript-eslint/no-require-imports -- ambiente do Jest é CommonJS
const { TestEnvironment } = require('jest-environment-jsdom');

class AmbienteJsdom extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    for (const nome of ['Request', 'Response', 'Headers', 'fetch']) {
      if (this.global[nome] === undefined) this.global[nome] = globalThis[nome];
    }
    // O `Request` do Node só aceita o AbortSignal do próprio Node, não o do jsdom.
    this.global.AbortController = globalThis.AbortController;
    this.global.AbortSignal = globalThis.AbortSignal;
  }
}

module.exports = AmbienteJsdom;
