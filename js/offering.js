"use strict"

let area = document.getElementById('area');
let gen_offer_btn = document.getElementById("gen_offer");
let accept_answer_btn = document.getElementById("accept_answer");
let hint = document.getElementById("hint_label");
let ul = document.getElementById("list");

let new_connection, new_channel;
let connections = [], channels = [], list_items = [], results = [];

let code_area = document.getElementById('code');
let counter = document.getElementById('counter');
let fileInput = document.getElementById('fileInput')
let sendFile = document.getElementById('sendFile')
let output = document.getElementById('output')
let result_label = document.getElementById('result');
let reader = new window.FileReader();
let wasmArrayBuffer;
let glob_asc;
let compiled;

function log_compile(value) {
    if (value[value.length - 1] !== '\n') {
        value += '\n';
    }
    output.value += value;
    output.scrollTop = output.scrollHeight;
}

require(["https://cdn.jsdelivr.net/npm/assemblyscript@latest/dist/sdk.js"], ({asc}) => {
    asc.ready.then(() => {
        log_compile("Compiler is ready");
        document.getElementById('compile_btn').disabled = false;
    });
    glob_asc = asc;
});

function datachannelopen() {
    connections.push(new_connection);
    channels.push(new_channel);
    let li = document.createElement("li");
    list_items.push(li);
    li.appendChild(document.createTextNode("Device №" + connections.length));
    li.className = "list-group-item text-primary";
    ul.appendChild(li);
    log('Data channel is open.');
    log('Send greating to consumer id=' + (channels.length - 1));
    new_channel.send(JSON.stringify({
        type: "greating",
        id: channels.length - 1
    }));
}

function datachannelmessage(message) {
    let data = JSON.parse(message.data)
    log('New message of type: ' + data.type);
    if (data.type === 'greating') {
        counter.innerHTML = parseInt(counter.innerHTML) + 1;
        fileInput.disabled = false;
        hint.innerText = "Add more nodes or compile/select wasm binary file, than pass args and execute!"
        hint.className = "fs-2 text-center text-success"
        log("The consumer id=" + data.id + " replied to the greeting.");
        if (connections.length !== 0 && (compiled !== null || fileInput.files.length)) {
            sendFile.disabled = false;
        }
    } else if (data.type === "result") {
        let id = data.id, result = data.result;
        log("Result from node(ID=" + id + "): " + result);
        results.push(parseInt(result));
        list_items[id].innerHTML = "Device №" + (id) + " gave the result: " + result;
        list_items[id].className = "list-group-item text-success fw-bold"
        if (results.length === parseInt(counter.innerHTML)) {
            log("Combining results:");
            processWASM(wasmArrayBuffer, results).then((result) => {
                log("Total result: " + result);
                results = [];
                result_label.innerText = "Result: " + result;
                result_label.className = "text-danger fs-3"
            });
        }
    } else if (data.type === "error") {
        let id = data.id, result = data.result;
        list_items[id].innerHTML = "Device №" + (id) + " threw exception: " + result;
        list_items[id].className = "list-group-item text-danger fw-bold"
    } else {
        log("Unknown message received:");
        log(data);
    }
}

function lasticecandidate() {
    log('Generating offer');
    let offer = new_connection.localDescription;
    log('Completed');
    area.value = JSON.stringify(offer);
    accept_answer_btn.disabled = false;
    area.select();
    area.setSelectionRange(0, 99999);
    document.execCommand("copy");
    area.value = "";
    hint.className = "text-center text-danger fs-2"
    hint.innerText = "Send the offer to the node and await the answer.";
    log("The offer has been copied to the clipboard");
}

async function clickcreateoffer() {
    log('Beginning of creating offer ');
    new_connection = createPeerConnection(lasticecandidate);
    new_connection.oniceconnectionstatechange = function (event) {
        let disconnected = 0;
        for (let i = 0; i < connections.length; i++) {
            let state = connections[i].iceConnectionState
            if (state === 'disconnected') {
                disconnected += 1;
                list_items[i].innerHTML = "Device №" + (i + 1) + " disconnected";
                list_items[i].className = "list-group-item text-danger fw-bold"
            }
        }
        counter.innerHTML = connections.length - disconnected;
    }

    new_channel = new_connection.createDataChannel('channel');
    new_channel.onopen = datachannelopen;
    new_channel.onmessage = datachannelmessage;
    let offer = await new_connection.createOffer();
    await new_connection.setLocalDescription(offer).then(() => {
        log("Local description OK");
    }).catch((error) => {
        log("LD set error: " + error);
    });
}

function compile() {
    log_compile('Compiling...')
    log_compile('--------------------------------')
    const stdout = glob_asc.createMemoryStream();
    const stderr = glob_asc.createMemoryStream();
    glob_asc.main([
        "module.ts",
        "-O3",
        "--importMemory",
        "--runtime", "stub",
        "--binaryFile", "module.wasm",
        "--textFile", "module.wat",
        "--sourceMap"
    ], {
        stdout,
        stderr,
        readFile(name, baseDir) {
            return name === "module.ts" ? code_area.value : null;
        },
        writeFile(name, data, baseDir) {
            if (name === 'module.wasm') {
                log_compile(`Compiled.\nSize: ${data.length} bytes`);
                compiled = data;
                if (connections.length !== 0) {
                    sendFile.disabled = false;
                }
            }
        },
        listFiles(dirname, baseDir) {
            return [];
        }
    }, err => {
        if (stdout.toString() !== '') {
            log_compile(`>>> STDOUT >>>\n${stdout.toString()}`);
        }
        if (stderr.toString() !== '') {
            log_compile(`>>> STDERR >>>\n${stderr.toString()}`);
        }
        if (err) {
            compiled = null;
            sendFile.disabled = true;
            log_compile(">>> THROWN >>>");
            log_compile(err);
        }
    });
}


async function handleFileInputChange() {
    const file = fileInput.files[0];
    compiled=null;
    if (!file) {
        log('Abort: no file chosen');
    } else {
        if (connections.length !== 0) {
            sendFile.disabled = false;
        }
    }
}


function sendData() {
    let file = fileInput.files[0];
    if (compiled !== null) {
        file = {
            'name': 'module.wasm',
            'size': compiled.length,
            'type': 'bytes'
        }
    }
    log(`File is ${[file.name, file.size, file.type].join(' ')}`);
    let args = document.getElementById('args').value.split(' ').map((value) => {
        return parseInt(value, 10)
    });
    let nodes_count = parseInt(counter.innerHTML), args_per_nodes = Math.floor(args.length / nodes_count);
    let nodes_ids = [];
    for (let i = 0; i < connections.length; i++) {
        if (connections[i].iceConnectionState === "connected") {
            nodes_ids.push(i);
        }
    }
    for (let i = 0; i < nodes_count; i++) {
        let begin = i * args_per_nodes,
            end = (i + 1 !== nodes_count) ? begin + args_per_nodes : args.length,
            partial_args = args.slice(begin, end);
        log("Sending args for node id=" + i + ": " + partial_args);
        list_items[nodes_ids[i]].innerHTML = "Device №" + (nodes_ids[i]) + " is calculating the result";
        list_items[nodes_ids[i]].className = "list-group-item text-warning fw-bold"
        channels[nodes_ids[i]].send(JSON.stringify({
            type: "args",
            file_size: file.size,
            args: partial_args
        }));
    }
    if (compiled === null) {
        reader.onloadend = onLoadEnd;
        reader.readAsArrayBuffer(file);
    } else {
        wasmArrayBuffer = compiled.slice(0);
        sendFileToNodes(compiled.slice(0));
    }
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function sendFileToNodes(file) {
    let data = {type: "file"};
    log("Sending file. Remain: " + file.byteLength)
    while (file.byteLength) {
        data.file_data = arrayBufferToBase64(file.slice(0, Math.min(chunkLength, file.byteLength)));
        file = file.slice(chunkLength);
        if (!file.byteLength) {
            data.last = true;
        }
        log("Data was sent. Remain: " + file.byteLength);
        for (let i = 0; i < channels.length; i++) {
            if (connections[i].iceConnectionState === "connected") {
                channels[i].send(JSON.stringify(data));
            }
        }
    }
}

function onLoadEnd(event) {
    wasmArrayBuffer = reader.result.slice(0);
    sendFileToNodes(reader.result)
}


async function clickanswerpasted() {
    log('Answer pasted');
    try {
        let answer = JSON.parse(area.value);
        if (answer['type'] === 'answer') {
            await new_connection.setRemoteDescription(answer).then(
                () => {
                    log("Remote description setting has been done");
                    log("Signaling state: " + new_connection.signalingState);
                    log("ICE connection state: " + new_connection.iceConnectionState);
                    log("ICE gathering state: " + new_connection.iceGatheringState);
                }).catch(
                (error) => {
                    log(error);
                }
            );
            area.value = "";
            accept_answer_btn.disabled = true;
        } else if (answer['type'] === "offer") {
            hint.innerText = "You pasted offer, but answer of another node required. Try to add node again.";
            area.value = "";

        }
    } catch (e) {
        hint.innerText = "Something wrong with your node answer"
        log(e);
    }


}

sendFile.addEventListener('click', sendData);
fileInput.addEventListener('change', handleFileInputChange, false);


