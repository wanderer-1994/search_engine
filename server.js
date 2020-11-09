const app = require("express")();
const request = require("request");
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 3000;

function fileType (url) {
    if(/\.css/.test(url)){
        return "css";
    }else if(/\.js/.test(url)){
        return "js";
    }else if(/\.\S{3}$/.test(url) && !/\.html$/.test(url)){
        return "file";
    }
    return "html";
}

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get("/status", async (req, res) => {
    console.log(req.body);
    console.log(req.query.q);
    res.send("ok");
})

app.listen(PORT, () => {
    console.log("proxy server listening: ", PORT);
})