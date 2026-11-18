// jsdom não traz TextEncoder/TextDecoder, que o react-router usa.
import { TextDecoder, TextEncoder } from 'util';

Object.assign(globalThis, { TextEncoder, TextDecoder });
