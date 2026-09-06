import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default {
    resolve: {
        alias: {
            '@shared/reconnect': path.resolve(root, '../shared/reconnect/js')
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

