const { Batcher } = require('promise-batcher');
let runCount = 0;
const batcher = new Batcher({
    batchingFunction: (data) => {
        runCount++;
        return Promise.resolve(data.map((n) => {
            return n + 1;
        }));
    }
});
const inputs = [1, 3, 5, 7];
// Start a series of individual requests
const promises = inputs.map((input) => batcher.getResult(input));
// Wait for all the requests to complete
Promise.all(promises).then((results) => {
    console.log(results); // [ 2, 4, 6, 8 ]
    // The requests were still done in a single run
    console.log(runCount); // 1
});