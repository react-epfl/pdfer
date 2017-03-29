/* global clearTimeout, console, process, require, setTimeout */

(function () {
  'use strict';

  var exec = require('child_process').exec;
  var express = require('express');
  var formidable = require('formidable');
  var fs = require('fs');
  var http = require('http');
  var os = require('os');
  var unoconv = require('unoconv');

  // config
  var serverPort = 8084;
  var unoconvPort = 8085;
  var apiKey = process.env.PDFER_API_KEY;
  var maxRetries = 5;
  var supportedFiles = [
    'csv',
    'doc',
    'doc6',
    'doc95',
    'docx',
    'met' ,
    'odd',
    'odg',
    'odp',
    'odt',
    'ott',
    'pct',
    'pot',
    'ppm',
    'ppsm',
    'ppsx',
    'ppt',
    'pptm',
    'pptx',
    'sldm',
    'sldx',
    'stc',
    'sti',
    'stp',
    'svg',
    'sxc',
    'sxd',
    'sxi',
    'wmf',
    'xls',
    'xls5',
    'xls95',
    'xlsx',
    'xlt',
    'xlt5',
    'xlt95'
  ];

  // queue variables
  var queuedFiles = [];
  var processing = false;
  var queueTimeout;

  // basic authentication middleware
  var checkApiKey = function (req, res, next) {
    if (!apiKey) return next();

    if (req.headers.authorization === 'Bearer ' + apiKey) return next();
    if (req.query.authorization === apiKey) return next();

    res.status(401);
    next('API key incorrect');
  };

  // kill LibreOffice processes completely
  var killLibreOffice = function (cb) {
    var command = 'ps aux | grep -i \'LibreOffice.*' + unoconvPort +
        '\' | grep -v grep | awk \'{print $2}\'';
    exec(command, function (err, stdout) {
      if (err || !stdout) return cb();

      var pids = stdout.split('\n');
      pids.forEach(function (pid) {
        if (!pid || !parseInt(pid, 10)) return;

        console.info('Killing LibreOffice process:', pid);
        try {
          process.kill(pid);
        } catch (err) {
          console.error('Error killing LibreOffice process:', pid);
        }
      });

      cb();
    });
  };

  // load LibreOffice
  var startUnoconvListener = function () {
    var unoconvListener = unoconv.listen({port: unoconvPort});
    unoconvListener.once('close', function () {
      // sometimes LibreOffice crashes, so we restart the listener, otherwise after the
      // crash it goes back to (re)lauching LibreOffice on every conversion.
      killLibreOffice(startUnoconvListener);
    });
    processing = false;
  };
  startUnoconvListener();

  // check a file exists and delete from disk
  var deleteFile = function (filePath) {
    fs.access(filePath, function (err) {
      if (err) return console.error('Unable to access file for deletion', filePath + ':', err);

      fs.unlink(filePath, function (err) {
        if (err) return console.error('Unable to delete', filePath + ':', err);

        console.info('Successfully deleted', filePath);
      });
    });
  };

  // convert document to PDF and save to disk
  var generatePdf = function (itemPath, pdfPath, cb) {
    var hashFileName;

    // try/catch just in case unoconv crashes
    try {
      unoconv.convert(itemPath, 'pdf', {port: unoconvPort}, function (err, data) {
        if (err) {
          console.error('Unoconv failed to convert', itemPath + ':', err);
          return cb(err);
        }

        fs.writeFile(pdfPath, data, cb);
      });
    } catch (err) {
      console.error('Unoconv crashed', err);
      return cb(err);
    }
  };

  // queue system used to only create one pdf at a time
  // unoconv/LibreOffice will crash if too many requests are made at once
  var processQueue = function () {
    if (!queuedFiles.length) return;

    // throttle the process queue attempts
    if (processing) {
      clearTimeout(queueTimeout);
      queueTimeout = setTimeout(function () {
        processQueue();
      }, 500);
      return;
    }

    var file = queuedFiles.shift();
    processing = true;
    generatePdf(file.itemPath, file.pdfPath, function (err, hashFileName) {
      // retry if there is an error and the file type is supported (within maximum retries limit)
      // don't retry when the file could not be opened (not supported)
      if (err && err.message && err.message.indexOf('could not be opened') < 0 &&
          file.retries < maxRetries) {
        file.retries++;
        queuedFiles.push(file);
      } else if (err) {
        file.callback('Error converting the file to PDF');
      } else {
        file.callback(null, hashFileName);
      }

      // continue processing the queue
      processing = false;
      processQueue();
    });
  };

  // add file to queue
  var queueFile = function (itemPath, pdfPath, cb) {
    queuedFiles.push({
      itemPath: itemPath,
      pdfPath: pdfPath,
      retries: 0,
      callback: cb
    });
    processQueue();
  };

  // handle conversion requests
  var convert = function (req, res) {
    var form = new formidable.IncomingForm();
    form.keepExtensions = true;
    form.hash = 'sha1';

    form.parse(req, function(err, fields, files) {
      if (err) return res.status(500).send('Error parsing request');

      var hashFileName = files.attachment.hash;
      var inputPath = files.attachment.path;
      var outputPath = os.tmpDir() + '/' + Date.now() + '_' + hashFileName + '.pdf';
      var ext = inputPath.substring(inputPath.lastIndexOf('.') + 1, inputPath.length);

      // check if file type can be converted to pdf
      if (supportedFiles.indexOf(ext) < 0) {
        return res.status(415).send('The extension .' + ext + ' is not supported');
      }

      console.info('Queueing file', files.attachment.name);

      // add to queue
      queueFile(inputPath, outputPath, function (err) {
        deleteFile(inputPath);

        if (err) {
          console.error('Error converting', files.attachment.name + ':', err);
          return res.status(500).send('Error converting file to PDF');
        } else {
          console.info('Successfully converted', files.attachment.name);
        }

        // send converted file
        res.status(200).sendFile(outputPath, function (err) {
          if (err) {
            console.error('Error sending PDF file for', files.attachment.name + ':', err);
          } else {
            console.info('Successfully sent PDF file for', files.attachment.name);
          }

          deleteFile(outputPath);
        });
      });
    });
  };

  // simple status page for monitoring
  var status = function (req, res) {
    console.log('Status request:', queuedFiles.length, 'files queued');
    res.status(200).send('Queued files: ' + queuedFiles.length);
  };

  // simple reset request
  var reset = function (req, res) {
    console.log('Reset request: Removing', queuedFiles.length, 'files from queue');
    res.status(200).send('Removed files: ' + queuedFiles.length);
    queuedFiles = [];
    processing = false;
  };

  // start server
  var app = express();
  var server = http.createServer(app);
  server.setTimeout(0);
  server.listen(serverPort);

  // server status logging
  server.on('listening', function () {
    console.info('PDF server listening on port', serverPort);
  });
  server.on('error', function (err) {
    console.error('Error starting PDF server on port', serverPort + ':', err.message);
  });

  // routes
  app.route('/convert')
    .post(
      checkApiKey,
      convert
    );

  app.route('/reset')
    .get(
      checkApiKey,
      reset
    );

  app.route('/status')
    .get(status);

  // error handling
  app.use(function (errMsg, req, res, next) {
    res.send(errMsg);
    console.error(errMsg);
  });

  // 404 error when path is incorrect
  app.use(function (req, res) {
    res.status(404).send('Page not found');
    console.error('Page not found:', req.url);
  });
}());
