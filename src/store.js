export class AppState {
    constructor() {
        this.state = {
            allParsedMessages: [],
            currentActiveEntityId: null,
            activeProtocols: [],
            sortCriteria: 'volume', // 'volume', 'symmetry', etc.
            isMapView: false
        };
        this.listeners = [];
    }

    subscribe(callback) {
        this.listeners.push(callback);
        // Call immediately with current state
        callback(this.state);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    setState(newState) {
        this.state = { ...this.state, ...newState };
        this.listeners.forEach(listener => listener(this.state));
    }

    getState() {
        return this.state;
    }
}

export const store = new AppState();
