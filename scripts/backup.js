const { createBackup } = require('./sqlite-backups');

if (require.main === module) {
  createBackup()
    .then(({ localPath, offsitePath }) => {
      console.log(`Respaldo verificado: ${localPath}`);
      if (offsitePath) console.log(`Copia externa verificada: ${offsitePath}`);
    })
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}