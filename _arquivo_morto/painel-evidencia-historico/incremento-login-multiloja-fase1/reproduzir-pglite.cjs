const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(process.env.PAINEL_PGLITE_MODULE || "@electric-sql/pglite");

async function main() {
  const banco = new PGlite();
  const ler = arquivo => fs.readFileSync(arquivo, "utf8");
  try {
    const equipe = ler("tests/painel-equipe.mjs");
    const authLocal = equipe.match(/await db\.exec\(\x60([\s\S]*?)\x60\)/)[1];
    await banco.exec(authLocal);
    const pasta = "supabase/migrations";
    const migrations = fs.readdirSync(pasta).filter(nome => nome.endsWith(".sql")).sort();
    for (const nome of migrations) await banco.exec(ler(path.join(pasta,nome)));
    console.log("Ledger local em memória:", migrations.length, "migrations, última:", migrations.at(-1));
    const testes = fs.readdirSync("tests").filter(nome => nome.endsWith(".sql") && !nome.endsWith("-producao.sql"));
    for (const nome of testes) {
      try {
        await banco.exec(ler(path.join("tests",nome)));
        console.log("PASS", nome);
      } catch (erro) {
        console.error("FAIL", nome, erro.code ?? "", erro.message);
        process.exitCode = 1;
        await banco.exec("rollback");
      }
    }
  } finally {
    await banco.close();
  }
}

main().catch(erro => {
  console.error(erro.code ?? "", erro.message);
  process.exitCode = 1;
});
