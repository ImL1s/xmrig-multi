import { fileURLToPath } from 'node:url';

export default {
    resolve: {
        alias: {
            '@wallet-address': fileURLToPath(new URL('../shared/wallet-address/js', import.meta.url))
        }
    },
    server: {
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
};
