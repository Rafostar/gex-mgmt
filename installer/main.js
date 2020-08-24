imports.gi.versions.Gtk = '3.0';

const { Gio, GLib, Gtk, Soup } = imports.gi;

const APP_NAME = 'Gex Installer';
const DATA_DIR = GLib.get_user_data_dir();
const INSTALL_DIR = DATA_DIR + '/gex';
const PREFIX_DIR = DATA_DIR.slice(0, DATA_DIR.lastIndexOf('/'));
const BIN_PATH = PREFIX_DIR + '/bin/gex';

class Downloader
{
    constructor()
    {
        this.totalDownloads = 0;

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
                return;
        }

        throw new Error('download retries exceeded');
    }

    _downloadFile(link, savePath)
    {
        return new Promise((resolve, reject) => {
            let file = Gio.file_new_for_path(savePath);

            if(!file.query_exists(null)) {
                let dir = file.get_parent();
                if(!dir.query_exists(null))
                    dir.make_directory_with_parents(null);
            }

            let data = '';
            let message = Soup.Message.new('GET', link);

            message.connect('got_chunk', (self, chunk) => {
                data += chunk.get_data();
            });
            this.session.queue_message(message, () => {
                if(message.status_code !== 200) {
                    return reject(
                        new Error(`response code: ${message.status_code}`)
                    );
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

        this.application = new Gtk.Application();
        this.application.connect('activate', () => this._openDialog());
        this.application.connect('startup', () => this._buildUI());
        this.application.run([]);
    }

    _buildUI()
    {
        this.assistant = new Gtk.Assistant();
        this.assistant.window_position = Gtk.WindowPosition.CENTER;

        this.assistant.connect('close', () => Gtk.main_quit());
        this.assistant.connect('cancel', () => Gtk.main_quit());

        this.downloader = new Downloader();
    }

    _openDialog()
    {
        this.assistant.set_size_request(720, 520);
        this.assistant.set_title(APP_NAME);

        let index = 1;
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

    getLabel(text, size)
    {
        size = size || 12;

        return new Gtk.Label({
            label: `<span font="${size}"><b>` + text + '</b></span>',
            use_markup: true
        });
    }

    addConfigToGrid(grid, text, value)
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

    _getPage1()
    {
        let label = this.getLabel(`Welcome to the ${APP_NAME}`, 14);

        return [label, 'Introduction', 'INTRO'];
    }

    _getPage2()
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
        this.addConfigToGrid(grid, 'Prefix Path', PREFIX_DIR);
        this.addConfigToGrid(grid, 'Install Path', INSTALL_DIR);
        this.addConfigToGrid(grid, 'Binary Path', BIN_PATH);

        return [grid, 'Info', 'CONTENT'];
    }

    _getPage3()
    {
        let grid = new Gtk.Grid({
            halign:Gtk.Align.CENTER,
            valign:Gtk.Align.CENTER
        });
        let label = this.getLabel('Installing...');
        let progress = new Gtk.LevelBar({
            width_request: 420
        });

        grid.attach(label, 0, 0, 1, 1);
        grid.attach(progress, 0, 1, 1, 1);

        return [grid, 'Installation', 'PROGRESS'];
    }

    _getPage4()
    {
        let label = this.getLabel('Gex was successfully installed');

        return [label, 'Finish', 'SUMMARY'];
    }
}

let installer = new Installer();
