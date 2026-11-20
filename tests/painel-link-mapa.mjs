import assert from "node:assert/strict";
import { test } from "node:test";
import { coordenadasDoMapa, linkDoCentro } from "../admin/regras/link-mapa.mjs";

const previsto={mapa_centro_latitude:-16.2,mapa_centro_longitude:-48.2};
test("Maps aceita link completo e distingue pino da câmera",()=>{
  for(const link of [
    "https://maps.google.com/?q=-16.2%2C-48.2",
    "https://www.google.com.br/maps/@-16.2,-48.2,17z",
    "https://www.google.com/maps/place/Café/@0,0,17z/data=!3d-16.2!4d-48.2!16sX",
    "https://www.google.com/maps/place/-16.2,-48.2",
    "https://www.google.com/maps/search/?api=1&query=-16.2,-48.2"
  ])assert.deepEqual(coordenadasDoMapa(link),previsto,link);
  assert.deepEqual(coordenadasDoMapa(linkDoCentro(previsto)),previsto);
  assert.deepEqual(coordenadasDoMapa(" "),{mapa_centro_latitude:null,mapa_centro_longitude:null});
});
test("Maps rejeita links encurtados, origens estranhas e faixa inválida",()=>{
  for(const link of ["https://maps.app.goo.gl/abc","https://goo.gl/maps/abc"])
    assert.throws(()=>coordenadasDoMapa(link),/Links curtos/);
  for(const link of ["-16.2,-48.2","https://google.com.evil/maps?q=0,0","https://google.com/maps?q=loja","https://google.com/maps/@1,2x","https://google.com/maps/place/%ZZ"])
    assert.throws(()=>coordenadasDoMapa(link),/link completo/);
  for(const q of ["90.000001,0","0,-180.000001"])
    assert.throws(()=>coordenadasDoMapa("https://google.com/maps?q="+q),/fora da faixa/);
  assert.deepEqual(coordenadasDoMapa("https://google.com/maps?q=90,-180"),{mapa_centro_latitude:90,mapa_centro_longitude:-180});
});
