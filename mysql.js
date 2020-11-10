const e = require("express");
const mysql = require("mysql");
const msClient = mysql.createConnection({
    host: "localhost",
    port: 3306,
    user: "root",
    password: "tkh170294",
    multipleStatements: true
});
msClient.connect(() => console.log("connected"));
msClient.promiseQuery = (query) => {
    return new Promise(async (resolve, reject) => {
        msClient.query(query, (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        })
    })
}

function removeVnCharacter(str){
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a")
    .replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e")
    .replace(/ì|í|ị|ỉ|ĩ/g, "i")
    .replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o")
    .replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u")
    .replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y")
    .replace(/đ/g, "d")
    .replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A")
    .replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E")
    .replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I")
    .replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O")
    .replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U")
    .replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y")
    .replace(/Đ/g, "D");
    return str;
}

function removeForeignCharacterSearchPhrase (search) {
    return search.replace(/\(+|\)+|-+|\/|\\|\,|\+/g, " ").replace(/^\s+|\s+$/g, "");
}

async function buildProductSearchIndex (msClient) {
    let query = `SELECT prod_name FROM \`phukiendhqg\`.\`product_fultex\``;
    let result = await msClient.promiseQuery(query);
    let keywords = [];
    result.forEach((item) => {
        let name = item.prod_name;
        name = removeForeignCharacterSearchPhrase(name);
        let name_keys = name.split(/\s+/);
        keywords = keywords.concat(name_keys);
        if(name_keys.length >= 2){
            for(let i = 0; i <= name_keys.length - 2; i++){
                let two_word_key = name_keys.slice(i, i + 2).join(" ");
                keywords.push(two_word_key);
            }
        }
    });
    for (let i = 0; i < keywords.length; i++) {
        keywords[i] = keywords[i].toUpperCase();
        if(keywords[i] == "" || keywords[i].length < 2){
            keywords.splice(i, 1);
            i -= 1;
        } 
    }
    for (let i = 0; i < keywords.length; i++) {
        for (let j = i + 1; j < keywords.length; j++) {
            if (keywords[j] == "" || keywords[j] == keywords[i]) {
                keywords.splice(j, 1);
                j -= 1;
            }
        }    
    }
    for (let i = 0; i < keywords.length; i++) {
        let is_compound = keywords[i].split(/\s/).length > 1 ? 1 : 0;
        console.log("processing index #", i + 1, " out of ", keywords.length, " in total ", keywords[i], " ", is_compound);
        let sql = `INSERT INTO \`phukiendhqg\`.\`product_search_index\` (prod_ids, key_word, is_compound) SELECT GROUP_CONCAT(prod_id) as "prod_ids", "${keywords[i]}" as "key_word", ${is_compound} as is_compound FROM \`phukiendhqg\`.\`product_fultex\` WHERE UPPER(prod_name) LIKE BINARY "%${keywords[i]}%" GROUP BY "key_word"`;
        let result = await msClient.promiseQuery(sql);
    }
    msClient.end();
}

async function copyProduct (msClient) {
    let require_escape = ["prod_link", "prod_thumb", "prod_img", "updated_info", "prod_description"];
    let sql = `SELECT * FROM \`phukiendhqg\`.\`product\``;
    let products = await msClient.promiseQuery(sql)
    for(let i = 261; i < products.length; i++){
        console.log("processing index #", i + 1, " out of ", products.length, " in total ");
        let prod = products[i];
        delete prod.prod_id;
        let objKeys = Object.keys(prod);
        let fields = "";
        let values = "";
        objKeys.forEach(key => {
            let is_require_escape = require_escape.find(reitem => {return reitem == key});
            if(prod[key] != null && prod[key] != "null" && !is_require_escape) prod[key] = unescape(prod[key]);
            fields += `${key}, `;
            (prod[key] == null || prod[key] == "null") ? values += `null, ` : values += `"${prod[key]}", `;
        });
        fields = fields.replace(/, $/, "");
        values = values.replace(/, $/, "");
        sql = `INSERT INTO \`phukiendhqg\`.\`product_fultex\` (${fields}) VALUES (${values})`;
        let result = await msClient.promiseQuery(sql);
    }
}

async function testSearch (msClient) {
    let sql = `SELECT \`prod_ids\` FROM \`phukiendhqg\`.\`product_search_index\` WHERE \`key_word\` LIKE BINARY "%USB%"`;
    let result = await msClient.promiseQuery(sql);
    console.log(result[0].prod_ids);
    let prod_ids = result[0].prod_ids;
    sql = `SELECT \`prod_id\`, \`prod_name\` FROM \`phukiendhqg\`.\`product_fultex\` WHERE \`prod_id\` IN (${prod_ids})`;
    result = await msClient.promiseQuery(sql);
    msClient.end();
}

function removeArrayDuplicate (array) {
    for(let i = 0; i < array.length; i++){
        for(let j = i + 1; j < array.length; j++){
            if(array[j] == array[i]){
                array.splice(j, 1);
                j -= 1;
            }
        }
    }
    return array;
}
 
function decomposeSearchPhrase (std_search_phrase) {
    this.generateKeys = (phrase) => {
        let single_keys = phrase.split(/\s+/);
        let compound_keys = [];
        if(single_keys.length >= 2){
            for(let i = 0; i <= single_keys.length - 2; i++){
                let two_word_key = single_keys.slice(i, i + 2).join(" ");
                compound_keys.push(two_word_key);
            }
        };
        return {
            single_keys: removeArrayDuplicate(single_keys),
            compound_keys: removeArrayDuplicate(compound_keys)
        };
    }
    let unsigned_search = removeVnCharacter(std_search_phrase);
    let strict_keys = this.generateKeys(std_search_phrase);
    let ease_keys = this.generateKeys(unsigned_search);
    let searchDecompsed = {
        strict_match_compound_words: strict_keys.compound_keys,
        strict_match_single_words: strict_keys.single_keys,
        ease_match_compound_words: ease_keys.compound_keys,
        ease_match_single_words: ease_keys.single_keys
    }
    return searchDecompsed;
}

function searchProductIndex (phrase) {
    this.generateSql = (search_config) => {
        let {keywords, like_mode, is_compound, weight, prefix, postfix} = {...search_config};
        if(!like_mode || !keywords || keywords.length < 1) return null;
        let condition = "";
        keywords.forEach(key => {
            condition += `\`key_word\` ${like_mode} "${prefix}${key}${postfix}" OR `;
        });
        condition = condition.replace(/\sOR\s$/, "");
        let sql = `SELECT GROUP_CONCAT(prod_ids) as prod_ids, ${weight} as \`weight\` FROM \`phukiendhqg\`.\`product_search_index\` WHERE \`is_compound\`=${is_compound} AND (${condition}) GROUP BY \`weight\``;
        return sql;
    }
    return new Promise(async (resolve, reject) => {
        let std_search_phrase = removeForeignCharacterSearchPhrase(phrase).toUpperCase();
        let searchDecompsed = decomposeSearchPhrase(std_search_phrase);
        let sql_1_weight = this.generateSql({
            keywords: searchDecompsed.ease_match_single_words,
            like_mode: "LIKE",
            is_compound: 0,
            weight: 1,
            prefix: "%",
            postfix: "%"
        });
        let sql_2_weight = this.generateSql({
            keywords: searchDecompsed.ease_match_single_words,
            like_mode: "LIKE",
            is_compound: 0,
            weight: 2,
            prefix: "",
            postfix: ""
        });
        let sql_3_weight = this.generateSql({
            keywords: searchDecompsed.ease_match_compound_words,
            like_mode: "LIKE",
            is_compound: 1,
            weight: 3,
            prefix: "%",
            postfix: "%"
        });
        let sql_4_weight = this.generateSql({
            keywords: searchDecompsed.strict_match_single_words,
            like_mode: "LIKE BINARY",
            is_compound: 0,
            weight: 4,
            prefix: "",
            postfix: ""
        });
        let sql_5_weight = this.generateSql({
            keywords: searchDecompsed.strict_match_compound_words,
            like_mode: "LIKE BINARY",
            is_compound: 1,
            weight: 5,
            prefix: "",
            postfix: ""
        });
        let sql = [];
        if(sql_1_weight != null) sql.push(sql_1_weight);
        if(sql_2_weight != null) sql.push(sql_2_weight);
        if(sql_3_weight != null) sql.push(sql_3_weight);
        if(sql_4_weight != null) sql.push(sql_4_weight);
        if(sql_5_weight != null) sql.push(sql_5_weight);
        if(sql.length < 1) return null;
        sql = sql.join(" UNION ALL ") + ";";
        let result = await msClient.promiseQuery(sql);
        let found_prods = [];
        for(let i = 5; i > 0; i--){
            let row_data = result.find(row => {
                return row.weight == i;
            });
            if(row_data && row_data.prod_ids != null && row_data.prod_ids.length > 0){
                let prod_ids = row_data.prod_ids.split(/,\s*/);
                prod_ids.forEach(prod_id_item => {
                    let found_match = found_prods.find(found_item => {
                        return found_item.prod_id == prod_id_item;
                    });
                    if(!found_match){
                        found_prods.push({
                            prod_id: prod_id_item,
                            weight: i,
                            position: Math.pow(i,2)
                        })
                    }else{
                        found_match.position += Math.pow(i,2);
                    }
                })
            }
        }
        found_prods.sort((a, b) => {
            if(a.weight != b.weight) return b.weight - a.weight;
            return b.position - a.position;
        });
        let prod_idss = [];
        found_prods.forEach(prod => {
            prod_idss.push(prod.prod_id);
        });
        console.log("index: ", prod_idss.join());
        resolve();
    })
}

function searchProductTable (phrase) {
    this.generateSql = (search_config) => {
        let {keywords, like_mode, weight, prefix, postfix} = {...search_config};
        if(!like_mode || !keywords || keywords.length < 1) return null;
        let sql = [];
        keywords.forEach(key => {
            sql.push(`SELECT GROUP_CONCAT(prod_id) as prod_ids, ${weight} as \`weight\` FROM \`phukiendhqg\`.\`product_fultex\` WHERE UPPER(prod_name) ${like_mode} "${prefix}${key}${postfix}" GROUP BY \`weight\``);
        });
        sql = sql.join(" UNION ALL ");
        return sql;
    }
    return new Promise(async (resolve, reject) => {
        let std_search_phrase = phrase.replace(/^\s+|\s+$/g, "").toUpperCase();
        let searchDecompsed = decomposeSearchPhrase(std_search_phrase);
        let sql_1_weight = this.generateSql({
            keywords: searchDecompsed.ease_match_single_words,
            like_mode: "LIKE",
            weight: 1,
            prefix: "%",
            postfix: "%"
        });
        let sql_2_weight = this.generateSql({
            keywords: searchDecompsed.ease_match_compound_words,
            like_mode: "LIKE",
            weight: 2,
            prefix: "%",
            postfix: "%"
        });
        let sql_3_weight = this.generateSql({
            keywords: searchDecompsed.strict_match_single_words,
            like_mode: "LIKE BINARY",
            weight: 3,
            prefix: "%",
            postfix: "%"
        });
        let sql_4_weight = this.generateSql({
            keywords: searchDecompsed.strict_match_compound_words,
            like_mode: "LIKE BINARY",
            weight: 4,
            prefix: "%",
            postfix: "%"
        });
        let sql = [];
        if(sql_1_weight != null) sql.push(sql_1_weight);
        if(sql_2_weight != null) sql.push(sql_2_weight);
        if(sql_3_weight != null) sql.push(sql_3_weight);
        if(sql_4_weight != null) sql.push(sql_4_weight);
        if(sql.length < 1) return null;
        sql = sql.join(" UNION ALL ");
        sql = `SELECT GROUP_CONCAT(prod_ids) as prod_ids, \`weight\` FROM (${sql}) as \`summary\` GROUP BY \`weight\`;`;
        let result = await msClient.promiseQuery(sql);
        let found_prods = [];
        for(let i = 4; i > 0; i--){
            let row_data = result.find(row => {
                return row.weight == i;
            });
            if(row_data && row_data.prod_ids != null && row_data.prod_ids.length > 0){
                let prod_ids = row_data.prod_ids.split(/,\s*/);
                prod_ids.forEach(prod_id_item => {
                    let found_match = found_prods.find(found_item => {
                        return found_item.prod_id == prod_id_item;
                    });
                    if(!found_match){
                        found_prods.push({
                            prod_id: prod_id_item,
                            weight: i,
                            position: i*10
                        })
                    }else{
                        found_match.position += i*10;
                    }
                })
            }
        }
        found_prods.sort((a, b) => {
            return b.position - a.position;
        });
        let prod_idss = [];
        found_prods.forEach(prod => {
            prod_idss.push(prod.prod_id);
        });
        console.log("table: ", prod_idss.join());
        resolve();
    })
}

// let rune_time = 1000;
let phrase = "tai nghe bluetooth nhét tai";
searchProductIndex(phrase);
// (async () => {
//     let start = Date.now();
//     for(let i = 0; i < rune_time; i++){
//         let result = await searchProductTable(phrase);
//     };
//     let end = Date.now();
//     console.log("total time 1000 Table: ", (end - start)/1000, "s");
//     msClient.end();
// })()

// testSearch(msClient);

// copyProduct (msClient);
// buildProductSearchIndex(msClient);