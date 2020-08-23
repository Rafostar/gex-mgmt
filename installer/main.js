imports.gi.versions.Gtk = '3.0';

const { Gio, GLib, Gtk, Soup } = imports.gi;

const APP_NAME = 'Gex Installer';

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
            let getPage = this[`_getPage${index}`];
            if(typeof getPage !== 'function')
                break;

            let [page, title, type] = getPage();

            this.assistant.append_page(page);
            this.assistant.set_page_title(page, title);
            this.assistant.set_page_type(page, Gtk.AssistantPageType[type]);
            this.assistant.set_page_complete(page, true);

            index++;
        }
        this.assistant.show_all();
        Gtk.main();
    }

    _getPage1()
    {
        let label = new Gtk.Label({
            label: `Welcome to the ${APP_NAME}`
        });

        return [label, 'Introduction', 'INTRO'];
    }

    _getPage2()
    {
        let label = new Gtk.Label({
            label: 'Gex was successfully installed'
        });

        return [label, 'Finish', 'SUMMARY'];
    }
}

let installer = new Installer();
