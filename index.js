#!/usr/bin/env node

if (process.stdout.isTTY) {
  process.env.FORCE_COLOR = "1";
}

(function() {
  const Listr = require("listr");
  const chalk = require("chalk");
  const debug = require("debug")("lint-prepush:index");
  const os = require('os');
  const Cache = require("file-system-cache").default;

  const cache = Cache({
    basePath: `${os.homedir()}/.lint-prepush`, // Path where cache files are stored.
    ns: process.cwd() // A grouping namespace for items.
  });

  const success = chalk.keyword("green");
  const error = chalk.keyword("red");
  const warning = chalk.keyword("yellow");

  const { log } = console;

  const { userConfig, execChildProcess } = require("./utils/common");
  const resolveMainTask = require("./utils/resolveMainTask");
  const fetchGitDiff = require("./utils/fetchGitDiff");

  if(!userConfig) {
    process.exitCode = 1;
    log(error("\nLoading Configuration⚙️ Failed!😑\n"));
    return;
  }

  let { base : baseBranch = 'master', tasks = {} } = userConfig || {};
  debug('Base Branch: ' + baseBranch);

  let getCurrentBranchCommand = 'git rev-parse --abbrev-ref HEAD';
  execChildProcess({ command: getCurrentBranchCommand })
    .then(currentBranch => {

      debug('Current Branch: ' + currentBranch);

      execChildProcess({ command: 'git rev-parse HEAD' })
        .then((commitHash = '') => {
          debug('Latest Commit SHA: ' + commitHash);

          let cachedCommitHash = cache.getSync("linted-hash") || "";
          debug('Cached Commit SHA: ' + cachedCommitHash);

          if(commitHash === cachedCommitHash) {
            debug('Skipping checks since the commit(s) have been linted already.');
            log(warning("\nNOTE: Skipping checks since the commit(s) have been linted already.\n"));
            return;
          }

          // see if the branch exists on the remote
          // adapted from:  https://stackoverflow.com/a/44401325/656011
          const isCurrentBranchPublished = `git ls-remote --exit-code --heads $(git remote | head -1) "${currentBranch}"`;

          let resolveBranch = Promise.resolve(baseBranch);

          // we're going to use the success/error of the call to isCurrentBranchPublished
          // so we'll return the correct branch based on the exit code we receive
          const getDiffBranch = execChildProcess({ command: isCurrentBranchPublished })
            .then(() => {
              const getRemote = 'git remote | head -1';

              // if the current branch has been pushed to the remote
              // we'll compare to the currentBranch for our diff
              return execChildProcess({ command: getRemote })
                .then((remote) => {
                  const branch = `${remote}/${currentBranch}`;
                  debug('Branch to Diff: ' + branch);
                  return branch;
                })
                .catch(() => {
                  debug('Branch to Diff: ' + baseBranch);

                  // if we can't find the remote, we'll fall back to the baseBranch
                  return baseBranch;
                });
            })
            .catch(() => {
              debug('Branch to Diff: ' + baseBranch);

              return resolveBranch;
            });

          // now that we have the branch we need to diff against, let's diff
          getDiffBranch.then((diffBranch) => {
            // Fetching committed git files
            fetchGitDiff( diffBranch ).then((committedGitFiles = []) => {
              debug(committedGitFiles);
              new Listr(resolveMainTask({ tasks, committedGitFiles }), {
                exitOnError: false,
                concurrent: true,
                collapse: false
              })
              .run()
              .then(() => {
                cache.setSync("linted-hash", commitHash);
                debug('Cached Current Commit Hash');
                log(success("\nVoila! 🎉  Code is ready to be Shipped.\n"));
              })
              .catch(({ errors }) => {
                process.exitCode = 1;
                errors.forEach(err => {
                  console.error(err.customErrorMessage);
                });
              });
            })
            .catch((message = '') => {
              process.exitCode = 1;
              log(warning(message));
            });
          })
          .catch((e) => {
            log(error(e));
            process.exitCode = 1;
            return;
          });
        });
    })
    .catch(() => {
      log(error('\nCould not get the current Branch.\n'));
      process.exitCode = 1;
      return;
    });
})();
