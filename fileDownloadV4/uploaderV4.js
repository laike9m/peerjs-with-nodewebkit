// NODE
var fs = require('fs');
var path = require('path');
var raf = require('random-access-file');
var settings = require('./settings');
var utils = require('./utils');
var BLOCK_SIZE = settings.BLOCK_SIZE;

var browserWindow;
exports.initWindow = function(window) {
  browserWindow = window;
};

// FIXME
var f1 = fs.openSync(path.join(path.dirname(__dirname), 'Advice.mp3'), 'r');
var bf1 = Buffer(settings.partsize);

exports.initV4Upload = function(my_uid, downloader_uid, hash, filesize){
  var totalFullBlocks = parseInt(filesize / BLOCK_SIZE);
  var realLastBlockSize = filesize - BLOCK_SIZE * totalFullBlocks;
  browserWindow.console.log('totalblock:' + totalFullBlocks.toString());
  browserWindow.console.log('lastblocksize:' + realLastBlockSize.toString());
  var path = 'Advice.mp3';  // TODO: retrieve from db
  global.socket.emit('connect_downloader', {
    'my_uid': my_uid,
    'downloader_uid': downloader_uid,
    'fileInfo': {
      'totalFullBlocks': totalFullBlocks,
      'realLastBlockSize': realLastBlockSize,
      'hash': hash,
      'path': path
    }
  });
};

global.socket.on('send_data_blocks', function(msg) {
  /*
  last_block_size = BLOCK_SIZE, unless the last block of file will be sent here
  msg {path, start, end, lastBlockSize, downloader, hash, test}
   */
  var file = raf(msg.path);  // TODO: record this file descriptor
  var index = msg.start;
  var bytesIndex = index * BLOCK_SIZE;
  var dataNode2DOM;
  file.read(index * BLOCK_SIZE, settings.partsize, function(err, data){
    if (err) {
      browserWindow.console.log("read index ", index, "error");
      console.log(err);
    } else {
      var intervalObj = setInterval(function() {
        if (index >= msg.end) {
          clearInterval(intervalObj);
          dataNode2DOM = {
            content: utils.toArrayBuffer(data.slice(bytesIndex, bytesIndex + msg.lastBlockSize)),
            hash: msg.hash,
            index: index,
            downloader: msg.downloader,
            test: msg.test
          };
          // 如果start=end, 说明是单独的重传请求, 这时 rangeLastBlock 应该为false
          // 否则下载端接到这个块之后会认为一个part传完了, 但其实只是重传, 该part-complete消息
          // 应该之前就emit过了
          dataNode2DOM.rangeLastBlock = (msg.start !== msg.end);
          global.socket.emit('send_block', dataNode2DOM);
          file.close();
        } else {
          dataNode2DOM = {
            content: utils.toArrayBuffer(data.slice(bytesIndex, bytesIndex + BLOCK_SIZE)),
            hash: msg.hash,
            index: index,
            downloader: msg.downloader,
            test: msg.test,
            rangeLastBlock: false
          };
          global.socket.emit('send_block', dataNode2DOM);
          index++;
          bytesIndex += BLOCK_SIZE;
        }
      }, 20);
    }
  });
});

/* TODO: 之后要把upload_main里的逻辑移入initV4Upload
function upload_main(my_uid, downloader_uid, hash, size){
    global.log.info(my_uid);
    global.log.info(downloader_uid);
    global.log.info(hash);

    if (typeof(global.upload_clients) === "undefined") {
        global.upload_clients = {}; // 初始化, 记录client, 因为要用到client.is_available属性
    }

    utils.get_sourcefile_from_hash(global.res_hash_collection, hash, parseInt(size), main);

    function main(path, size) {
        fs.appendFileSync(mylog, 'sizetype: ' + typeof(size) + '\n');
        var totalparts = parseInt((size+partsize-1)/partsize);
        var totalblocks = parseInt((size+BLOCK_SIZE-1)/BLOCK_SIZE);

        var pool = 'u:' + my_uid.toString() + ':' + hash.toString() + ':' + downloader_uid.toString();
        fs.appendFileSync(mylog, "pool: " + pool);
        var client_id = pool + '-' + Date.now(); // 用pool+timestamp表示上传端的client,保证唯一性

        var interval_obj = setInterval(function () {
            if (global.upload_clients[client_id]) { // 有可能还是undefined, 所以要等到client存在
                if (global.upload_clients[client_id].is_available) {
                    clearInterval(interval_obj);
                    var socket = global.upload_clients[client_id].socket;
                    socket.removeAllListeners("message");
                    addEventListener(socket, path, totalparts, totalblocks, parseInt(size), client_id);
                    fs.appendFileSync(mylog, "uploader listening on " + socket.address().port+'\n');
                    fs.appendFileSync(mylog, "prepare to upload\n");
                }
            }
        }, 100); // 500ms is too long

        create_upload_client(global.nat_type, pool, client_id, interval_obj);
    }
}
*/