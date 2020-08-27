imports.gi.versions.Gtk = '3.0';

const { Gio, GLib, Gtk, Soup } = imports.gi;
const ByteArray = imports.byteArray;

const APP_NAME = 'Gex Installer';
const DATA_DIR = GLib.get_user_data_dir();
const INSTALL_DIR = DATA_DIR + '/gex';
const PREFIX_DIR = DATA_DIR.slice(0, DATA_DIR.lastIndexOf('/'));
const BIN_PATH = PREFIX_DIR + '/bin/gex';
const GEX_SRC = 'https://raw.githubusercontent.com/Rafostar/gex/master';

class Downloader
{
    constructor()
    {
        this.session = new Soup.Session({
            user_agent: 'gex_installer',
            timeout: 5,
            use_thread_context: true
        });
    }

    async downloadFile(link, savePath)
    {
        let retries = 3;

        while(retries--) {
            let res = await this._downloadFile(link, savePath).catch(logError);
            if(res)
                return res;
        }

        throw new Error('download retries exceeded');
    }

    _downloadFile(link, savePath)
    {
        return new Promise((resolve, reject) => {
            let file;

            if(savePath) {
                file = Gio.file_new_for_path(savePath);

                if(!file.query_exists(null)) {
                    let dir = file.get_parent();
                    if(!dir.query_exists(null))
                        dir.make_directory_with_parents(null);
                }
            }

            let data = '';
            let message = Soup.Message.new('GET', link);

            message.connect('got_chunk', (self, chunk) => {
                let chunkData = chunk.get_data();
                data += (chunkData instanceof Uint8Array)
                    ? ByteArray.toString(chunkData)
                    : chunkData;
            });
            this.session.queue_message(message, () => {
                if(message.status_code !== 200) {
                    return reject(
                        new Error(`response code: ${message.status_code}`)
                    );
                }
                if(!savePath) {
                    let json = null;

                    try { json = JSON.parse(data) }
                    catch(err) { reject(err) }

                    return resolve(json);
                }
                this._saveFile(data, file)
                    .then(() => resolve(true))
                    .catch(err => reject(err));
            });
        });
    }

    _saveFile(data, file)
    {
        return new Promise((resolve, reject) => {
            file.replace_contents_bytes_async(
                GLib.Bytes.new_take(data),
                null,
                false,
                Gio.FileCreateFlags.NONE,
                null,
                (self, task) => this._onSaveFileCompleted(self, task, (res) => {
                    (res)
                        ? resolve()
                        : reject(new Error('could not save file'));
                })
            );
        });
    }

    _onSaveFileCompleted(file, task, cb)
    {
        let [res, etag] = file.replace_contents_finish(task);

        if(etag)
            GLib.free(etag);

        cb(res);
    }
}

class Installer
{
    constructor()
    {
        GLib.set_prgname(APP_NAME);

        this.installStarted = false;

        this.application = new Gtk.Application();
        this.application.connect('activate', () => this._openDialog());
        this.application.connect('startup', () => this._buildUI());
        this.application.run([]);
    }

    _buildUI()
    {
        this.assistant = new Gtk.Assistant({ use_header_bar: true });
        this.assistant.window_position = Gtk.WindowPosition.CENTER;

        this.assistant.connect('close', () => Gtk.main_quit());
        this.assistant.connect('cancel', () => Gtk.main_quit());
        this.assistant.connect('prepare', this._onPagePrepare.bind(this));

        this.downloader = new Downloader();
    }

    _openDialog()
    {
        this.assistant.set_size_request(720, 520);
        this.assistant.set_title(APP_NAME);

        let index = 0;
        while(true) {
            if(typeof this[`_getPage${index}`] !== 'function')
                break;

            let [page, title, type] = this[`_getPage${index}`]();

            this.assistant.append_page(page);
            this.assistant.set_page_title(page, title);
            this.assistant.set_page_type(page, Gtk.AssistantPageType[type]);
            this.assistant.set_page_complete(page, (type !== 'PROGRESS'));

            index++;
        }
        this.assistant.show_all();
        Gtk.main();
    }

    async installGex()
    {
        let json = await this.downloader.downloadFile(
            `${GEX_SRC}/gex.json`
        ).catch(err => this._onInstallError(err));

        let progress = 0;
        let fraction = 1 / json.files.length;

        for(let file of json.files) {
            await this.downloader.downloadFile(
                `${GEX_SRC}/${file}`,
                `${INSTALL_DIR}/${file}`
            ).catch(err => this._onInstallError(err));
            progress += fraction;
            let progressValue = (progress < 0.99) ? progress : 1;
            this.progressBar.set_fraction(progressValue);
        }
    }

    getLabel(text, size)
    {
        return new Gtk.Label({
            label: this.getMarkupText(text, size),
            use_markup: true
        });
    }

    getMarkupText(text, size)
    {
        return `<span font="${size || 12}"><b>` + text + '</b></span>';
    }

    _getPage0()
    {
        let label = this.getLabel(`Welcome to the ${APP_NAME}`, 14);

        return [label, 'Introduction', 'INTRO'];
    }

    _getPage1()
    {
        let grid = new Gtk.Grid({
            halign:Gtk.Align.CENTER,
            valign:Gtk.Align.CENTER,
            row_spacing: 8,
            column_spacing: 8
        });

        let label = this.getLabel(`Gex will be installed to these directories`);
        label.margin_bottom = 8;
        grid.attach(label, 0, 0, 2, 1);

        this.configRow = 1;
        this._addConfigToGrid(grid, 'Install Path', INSTALL_DIR);
        this._addConfigToGrid(grid, 'Binary Path', BIN_PATH);

        return [grid, 'Info', 'CONTENT'];
    }

    _getPage2()
    {
        let grid = new Gtk.Grid({
            halign:Gtk.Align.CENTER,
            valign:Gtk.Align.CENTER
        });
        this.progressLabel = this.getLabel('Installing...');
        this.progressBar = new Gtk.ProgressBar({
            width_request: 420
        });

        grid.attach(this.progressLabel, 0, 0, 1, 1);
        grid.attach(this.progressBar, 0, 1, 1, 1);

        return [grid, 'Installation', 'PROGRESS'];
    }

    _getPage3()
    {
        let label = this.getLabel('Gex was successfully installed');

        return [label, 'Finish', 'SUMMARY'];
    }

    _addConfigToGrid(grid, text, value)
    {
        let label = new Gtk.Label({ label: text });
        let entry = new Gtk.Entry({
            text: value,
            width_chars: 40,
            sensitive: false
        });

        grid.attach(label, 0, this.configRow, 1, 1);
        grid.attach(entry, 1, this.configRow, 1, 1);

        this.configRow++;
    }

    _onPagePrepare(assistant, page, ss)
    {
        if(
            this.assistant.get_page_type(page) !== Gtk.AssistantPageType.PROGRESS
            || this.installStarted
        )
            return;

        this.installStarted = true;
        this.installGex().then(() => {
            this.progressLabel.label = this.getMarkupText('Installed');
            this.assistant.set_page_complete(page, true);
        });
    }

    _onInstallError(err)
    {
        logError(err);
        Gtk.main_quit();
    }
}

let installer = new Installer();
