module.exports = {apps:[
 {name:'lagune-api',script:'server/index.js',cwd:'/srv/lagune',instances:1,exec_mode:'fork',env:{NODE_ENV:'production',PORT:'3001'},max_memory_restart:'512M',time:true,kill_timeout:10000},
 {name:'lagune-worker',script:'server/worker.js',cwd:'/srv/lagune',instances:1,exec_mode:'fork',env:{NODE_ENV:'production'},max_memory_restart:'256M',time:true,kill_timeout:65000}
]};
