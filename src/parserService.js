export class ParserService {
    constructor() {
        this.worker = new Worker('src/parser.worker.js');
    }

    parse(rawText) {
        return new Promise((resolve, reject) => {
            this.worker.onmessage = (e) => {
                resolve(e.data);
            };
            this.worker.onerror = (error) => {
                reject(error);
            };
            this.worker.postMessage(rawText);
        });
    }
}

export const parserService = new ParserService();
