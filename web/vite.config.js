import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default {
    resolve: {
        alias: {
            '@shared/reconnect': path.resolve(root, '../shared/reconnect/js'),
            '@wallet-address': fileURLToPath(new URL('../shared/wallet-address/js', import.meta.url))
        }
    },
    server: {
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
        fs: {
            allow: [root, path.resolve(root, '../shared')]
        }
    },
};
