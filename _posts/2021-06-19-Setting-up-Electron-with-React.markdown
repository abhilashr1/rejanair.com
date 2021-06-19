---
layout: post
title:  "Setting up Electron with React"
date:   2021-06-19 16:00:00 +0700
---

There are tons of desktop UI frameworks, some even multi-platform, but nothing beats the popularity of Electron. Qt does come to mind for better performance and opengl support, but nothing can beat the community support and the code reusability that electron combined with a frontend javascript framework like React provides. I wanted to prototype a cross platform desktop application and this is how I got started. 

<img src="/assets/electron-react.png" alt="Electron React" style="width:500px; display:block; margin:0 auto;" />

#### Do it quicker

If you want to get things done quicker, I'd recommend you start with the [react electron boilerplate](https://github.com/electron-react-boilerplate/electron-react-boilerplate). It provides reasonable defaults and uses webpack to get started. 

However, if you'd like the reasonable defaults which frequently updated create-react-app provides, then read on. 

#### The idea

The idea is to run electron differently for two modes - development and production. For development environment, we make use of webpack server to serve the hot reloaded app via localhost. For production, we intend to build the bundles first and then serve them inside electron as html.  

#### Init your react project

I use create-react-app with typescript, so something like this works for me. 

`npx create-react-app electron-app --template typescript`

We plan to use electron-builder to package our electron app, so let's add those as dependencies. We will also use concurrently and wait-on to time our scripts so let's add those as well. 

`npm i --save-dev electron electron-builder concurrently time-on` 

#### Init your electron 

Our electron code does not need webpack to build, so it needs to be outside the src folder. I created an electron folder at the root and created an entrypoint file, `main.js`

```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');
const url = require('url');

let mainWindow;

function createWindow () {
  const startUrl = process.env.DEV_URL || url.format({
    pathname: path.join(__dirname, '../index.html'),
    protocol: 'file:',
    slashes: true,
  });
  mainWindow = new BrowserWindow({ width: 800, height: 600 });
  mainWindow.loadURL(startUrl);
  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', createWindow);app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});
```

#### Configure your package scripts

We need to handle two instances, development and production separately. 

For development, since we rely on webpack's dev servers to serve us content, we need to first run webpack in development mode, watch for localhost and then run electron. We can do so by adding this script in the package.json file. 

`"start-electron": "export BROWSER=none DEV_URL=http://localhost:3000 && concurrently \"react-scripts start\" \"wait-on http://localhost:3000 && electron .\""`

We use `BROWSER=none` to avoid launching browser whenever webpack server finishes building the app. We also use `DEV_URL` to point to the localhost where we expect webpack server to run. For Windows, use `set` instead of `export`.

For production/packaging the app, we would need to build the app along with the electron bits and then use `electron-builder` to create the portable executables/installers. 

First, we need to include the electron entrypoint in the build folder. Let's solve that with another script. 

`"build-electron": "cp -r electron/. build/electron"`

Next, let's use `electron-builder` to package. But first, we need to add a section in package.json which electron-builder reads. 

```json
  "build": {
    "files": [
      "build/**/*",
      "node_modules/**/*"
    ],
    "publish": {
      "provider": "github",
      "repo": "example",
      "owner": "author"
    }
  }
```

Let's finally add a script to run the builder. 

`"package": "electron-builder build --mac --win -c.extraMetadata.main=build/electron/main.js --publish never"`

To have a working executable, the step is to first build the react app, then the electron app and run package. We can combine all these into a single script for convenience.  

There are other things we could do, like setup ipc for the react app to talk to the electron app. This [article](https://medium.com/@johndyer24/building-a-production-electron-create-react-app-application-with-shared-code-using-electron-builder-c1f70f0e2649) from @johndyer24 provides more info on that in detail. 

Here's a [link](https://github.com/abhilashr1/Electron-CRA-Boilerplate) to the project if you want to play around with the final version. 