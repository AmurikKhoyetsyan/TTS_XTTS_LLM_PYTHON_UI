export function log(msg, level = '') {
    try {
        fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msg: String(msg), level: level || '' }),
        }).catch(() => {});
    } catch (_) {}
}

export function logLocal(_msg, _level = '') {}

export const progress = {
    start(_label) {},
    update(_frac, _desc) {},
    finish(_ok) {},
};
