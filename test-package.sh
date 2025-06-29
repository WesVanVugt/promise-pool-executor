#!/bin/bash
set -eu
npm pack
cd test-package
git clean -fdx -e node_modules
cat ../package.json | sed -r 's/("name": ")[^"]+/\1test-package/' > package.json
cat ../jest.config.js | sed '/testPathIgnorePatterns:/d' > jest.config.js
cp ../*.tgz package.tgz
cp -n ../ts/test/* ts/test/
npm un promise-pool-executor --ignore-scripts --no-save
npm i -D --ignore-scripts --no-save
npm i package.tgz --no-save
npm run test:local
