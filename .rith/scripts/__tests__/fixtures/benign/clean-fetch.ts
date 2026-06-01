#!/usr/bin/env bun
// Clean: legitimate fetch to github.com (allowlisted host)
const res = await fetch('https://github.com/artur-ciocanu/rith-engine/releases/latest');
const data = (await res.json()) as { tag_name: string };
console.log(JSON.stringify({ latest: data.tag_name }));
