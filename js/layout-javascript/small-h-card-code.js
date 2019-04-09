// Constructor
var DynamicList = function(id, data, container) {
  var _this = this;

  this.flListLayoutConfig = window.flListLayoutConfig;
  this.smallHorizontalLayoutMapping = {
    'small-h-card': {
      'base': 'templates.build.small-h-card-base',
      'loop': 'templates.build.small-h-card-loop',
      'detail': 'templates.build.small-h-card-detail',
    }
  };

  this.operators = {
    '==': function(a, b) { return a == b },
    '!=': function(a, b) { return a != b },
    '>': function(a, b) { return a > b },
    '>=': function(a, b) { return a >= b },
    '<': function(a, b) { return a < b },
    '<=': function(a, b) { return a <= b }
  };

  // Makes data and the component container available to Public functions
  this.data = data;
  this.data['summary-fields'] = this.data['summary-fields'] || this.flListLayoutConfig[this.data.layout]['summary-fields'];
  this.$container = $('[data-dynamic-lists-id="' + id + '"]');
  this.queryOptions = {};

  // Other variables
  // Global variables
  this.allowClick = true;

  this.emailField = 'Email';
  this.myProfileData;
  this.modifiedProfileData;
  this.myUserData;

  this.listItems;
  this.modifiedListItems
  this.dataSourceColumns;
  this.directoryDetailWrapper;

  this.queryOpen = false;
  this.queryPreFilter = false;
  this.pvPreviousScreen;
  this.pvPreFilterQuery;
  this.pvOpenQuery;

  // Cache XHR requests to media folders to get files
  this.cachedFiles = {};

  /**
   * this specifies the batch size to be used when rendering in chunks
   */
  this.INCREMENTAL_RENDERING_BATCH_SIZE = 100;

  // Register handlebars helpers
  this.src = this.data.advancedSettings && this.data.advancedSettings.detailHTML
    ? this.data.advancedSettings.detailHTML
    : Fliplet.Widget.Templates[_this.smallHorizontalLayoutMapping[this.data.layout]['detail']]();

  this.profileHTML = Handlebars.compile(this.src);

  this.registerHandlebarsHelpers();
  // Get the current session data
  Fliplet.User.getCachedSession().then(function(session) {
    if (session && session.entries && session.entries.dataSource) {
      _this.myUserData = session.entries.dataSource.data;
    } else if (session && session.entries && session.entries.saml2) {
      _this.myUserData = session.entries.saml2.user;
      _this.myUserData[_this.data.userEmailColumn] = _this.myUserData.email;
      _this.myUserData.isSaml2 = true;
    }

    // Start running the Public functions
    _this.initialize();
  });
};

DynamicList.prototype.registerHandlebarsHelpers = function() {
  // Register your handlebars helpers here
  var _this = this;

  Handlebars.registerHelper('ifCond', function (v1, operator, v2, options) {
    switch (operator) {
      case '==':
        return (v1 == v2) ? options.fn(this) : options.inverse(this);
      case '===':
        return (v1 === v2) ? options.fn(this) : options.inverse(this);
      case '!=':
        return (v1 != v2) ? options.fn(this) : options.inverse(this);
      case '!==':
        return (v1 !== v2) ? options.fn(this) : options.inverse(this);
      case '<':
        return (v1 < v2) ? options.fn(this) : options.inverse(this);
      case '<=':
        return (v1 <= v2) ? options.fn(this) : options.inverse(this);
      case '>':
        return (v1 > v2) ? options.fn(this) : options.inverse(this);
      case '>=':
        return (v1 >= v2) ? options.fn(this) : options.inverse(this);
      case '&&':
        return (v1 && v2) ? options.fn(this) : options.inverse(this);
      case '||':
        return (v1 || v2) ? options.fn(this) : options.inverse(this);
      default:
        return options.inverse(this);
    }
  });

  Handlebars.registerHelper('validateImage', function(image) {
    var validatedImage = image;

    if (!validatedImage) {
      return '';
    }

    if (Array.isArray(validatedImage) && !validatedImage.length) {
      return '';
    }

    // Validate thumbnail against URL and Base64 patterns
    var urlPattern = /^https?:\/\//i;
    var base64Pattern = /^data:image\/[^;]+;base64,/i;
    if (!urlPattern.test(validatedImage) && !base64Pattern.test(validatedImage)) {
      return '';
    }

    if (/api\.fliplet\.(com|local)/.test(validatedImage)) {
      // attach auth token
      validatedImage += (validatedImage.indexOf('?') === -1 ? '?' : '&') + 'auth_token=' + Fliplet.User.getAuthToken();
    }

    return validatedImage;
  });

  Handlebars.registerHelper('formatDate', function(date) {
    return moment(date).utc().format('DD MMMM YYYY');
  });

  Handlebars.registerHelper('removeSpaces', function(context) {
    return context.replace(/\s+/g, '');
  });
}

DynamicList.prototype.attachObservers = function() {
  var _this = this;
  // Attach your event listeners here
  _this.$container
    .on('click', '.small-h-card-list-detail-button a', function() {
      var _that = $(this);
       Fliplet.Analytics.trackEvent({
        category: 'list_dynamic_' + _this.data.layout,
        action: 'profile_buttons',
        label: _that.find('.small-h-card-list-detail-button-text').text()
      });
    })
    .on('touchstart', '.small-h-card-list-item', function(event) {
      event.stopPropagation();
      if (!$(this).hasClass('open')) {
        $(this).addClass('hover');
      }
    })
    .on('touchmove', '.small-h-card-list-item', function() {
      _this.allowClick = false;
      $(this).removeClass('hover');
    })
    .on('touchend touchcancel', '.small-h-card-list-item', function() {
      $(this).removeClass('hover');
      // Delay to compensate for the fast click event
      setTimeout(function() {
        _this.allowClick = true;
      }, 100);
    })
    .on('click', '.small-h-card-list-item', function(event) {
      var _that = $(this);
      var entryId = $(this).data('entry-id');
      var entryTitle = $(this).find('.small-h-card-list-item-text').text();

      Fliplet.Analytics.trackEvent({
        category: 'list_dynamic_' + _this.data.layout,
        action: 'entry_open',
        label: entryTitle
      });

      var beforeOpen = Promise.resolve();

      if (typeof _this.data.beforeOpen === 'function') {
        beforeOpen = _this.data.beforeOpen({
          config: _this.data,
          entry: _.find(_this.listItems, { id: entryId }),
          entryId: entryId,
          entryTitle: entryTitle
        });

        if (!(beforeOpen instanceof Promise)) {
          beforeOpen = Promise.resolve(beforeOpen);
        }
      }

      beforeOpen.then(function () {
        if (_this.data.summaryLinkOption === 'link' && _this.data.summaryLinkAction) {
          _this.openLinkAction(entryId);
          return;
        }
        // find the element to expand and expand it
        if (_this.allowClick && $(window).width() < 640) {
          _this.directoryDetailWrapper = _that.find('.small-h-card-list-detail-wrapper');
          _this.expandElement(_this.directoryDetailWrapper, entryId);
        } else if (_this.allowClick && $(window).width() >= 640) {
          _this.showDetails(entryId);
        }
      });
    })
    .on('click', '.small-h-card-detail-overlay-close', function(event) {
      event.stopPropagation();

      var result;

      if ($(this).hasClass('go-previous-screen')) {
        if (!_this.pvPreviousScreen) {
          return;
        }

        try {
          result = (typeof _this.pvPreviousScreen === 'function') && _this.pvPreviousScreen();
        } catch (error) {
          console.error('Your custom function contains an error: ' + error);
        }

        if (!(result instanceof Promise)) {
          result = Promise.resolve();
        }

        return result.then(function () {
          return Fliplet.Navigate.back();
        }).catch(function (error) {
          console.error(error);
        });
      }

      if ($(window).width() < 640) {
        _this.collapseElement(_this.directoryDetailWrapper);
        _this.directoryDetailWrapper = undefined;
      } else {
        _this.closeDetails();
      }
    })
    .on('click', '.dynamic-list-add-item', function() {
      var options = {
        title: 'Link not configured',
        message: 'Form not found. Please check the component\'s configuration.',
      };

      if (_this.data.addEntryLinkAction) {
        _this.data.addEntryLinkAction.query = '?mode=add';

        if (typeof _this.data.addEntryLinkAction.page !== 'undefined' && _this.data.addEntryLinkAction.page !== '') {
          Fliplet.Navigate.to(_this.data.addEntryLinkAction)
            .catch(function() {
              Fliplet.UI.Toast(options);
            });
        } else {
          Fliplet.UI.Toast(options);
        }
      }
    })
    .on('click', '.dynamic-list-edit-item', function() {
      var entryID = $(this).parents('.small-h-card-detail-overlay').find('.small-h-card-list-detail-content-scroll-wrapper').data('entry-id');
      var options = {
        title: 'Link not configured',
        message: 'Form not found. Please check the component\'s configuration.',
      };

      if (_this.data.editEntryLinkAction) {
        _this.data.editEntryLinkAction.query = '?dataSourceEntryId=' + entryID;

        if (typeof _this.data.editEntryLinkAction.page !== 'undefined' && _this.data.editEntryLinkAction.page !== '') {
          Fliplet.Navigate.to(_this.data.editEntryLinkAction)
            .catch(function() {
              Fliplet.UI.Toast(options);
            });
        } else {
          Fliplet.UI.Toast(options);
        }
      }
    })
    .on('click', '.dynamic-list-delete-item', function() {
      var _that = $(this);
      var entryID = $(this).parents('.small-h-card-detail-overlay').find('.small-h-card-list-detail-content-scroll-wrapper').data('entry-id');
      var options = {
        title: 'Are you sure you want to delete the list entry?',
        labels: [
          {
            label: 'Delete',
            action: function (i) {
              _that.text('Deleting...').addClass('disabled');

              // Run Hook
              Fliplet.Hooks.run('flListDataBeforeDeleteEntry', {
                entryId: entryID,
                config: _this.data,
                id: _this.data.id,
                uuid: _this.data.uuid,
                container: _this.$container
              })
                .then(function() {
                  if (_this.data.deleteData && typeof _this.data.deleteData === 'function') {
                    return _this.data.deleteData(entryID);
                  }

                  return _this.deleteEntry(entryID);
                })
                .then(function onRemove(entryId) {
                  _.remove(_this.listItems, function(entry) {
                    return entry.id === parseInt(entryId, 10);
                  });

                  _that.text('Delete').removeClass('disabled');

                  if ($(window).width() < 640) {
                    _this.collapseElement(_this.directoryDetailWrapper);
                    _this.directoryDetailWrapper = undefined;
                  } else {
                    _this.closeDetails();
                  }
                  _this.prepareToRenderLoop(_this.listItems);
                  _this.renderLoopHTML();
                })
                .catch(function(error) {
                  Fliplet.UI.Toast({
                    message: 'Error deleting entry',
                    actions: [
                      {
                        label: 'Details',
                        action: function () {
                          Fliplet.UI.Toast({
                            html: error.message || error
                          });
                        }
                      }
                    ]
                  });
                });
            }
          }
        ],
        cancel: true
      }

      Fliplet.Hooks.run('flListDataBeforeDeleteConfirmation', {
        entryId: entryID,
        config: _this.data,
        id: _this.data.id,
        uuid: _this.data.uuid,
        container: _this.$container
      }).then(function() {
        Fliplet.UI.Actions(options);
      });
    });
}

DynamicList.prototype.deleteEntry = function(entryID) {
  var _this = this;

  return Fliplet.DataSources.connect(_this.data.dataSourceId).then(function (connection) {
    return connection.removeById(entryID, { ack: true });
  }).then(function () {
    return Promise.resolve(entryID);
  });
}

DynamicList.prototype.filterRecords = function(records, filters) {
  var _this = this;

  return _.filter(records, function(record) {
    var matched = 0;

    filters.some(function(filter) {
      var condition = filter.condition;
      var rowData;
      // Case insensitive
      if (filter.value !== null && filter.value !== '' && typeof filter.value !== 'undefined') {
        filter.value = filter.value.toLowerCase();
      }
      if (record.data[filter.column] !== null && record.data[filter.column] !== '' && typeof record.data[filter.column] !== 'undefined') {
        rowData = record.data[filter.column].toString().toLowerCase();
      }

      if (condition === 'contains') {
        if (rowData !== null && typeof rowData !== 'undefined' && rowData.indexOf(filter.value) > -1) {
          matched++;
        }
        return;
      }
      if (condition === 'notcontain') {
        if (rowData !== null && typeof rowData !== 'undefined' && rowData.indexOf(filter.value) === -1) {
          matched++;
        }
        return;
      }
      if (condition === 'regex') {
        var pattern = new RegExp(filter.value);
        if (pattern.test(rowData)){
          matched++;
        }
        return;
      }
      if (_this.operators[condition](rowData, filter.value)) {
        matched++;
        return;
      }
    });

    return matched >= filters.length ? true : false;
  });
}

DynamicList.prototype.prepareData = function(records) {
  var _this = this;
  var filtered;

  // Prepare sorting
  if (_this.data.sortOptions.length) {
    var fields = [];
    var sortOrder = [];
    var sortedColumns = [];

    _this.data.sortOptions.forEach(function(option) {
      fields.push({
        column: option.column,
        type: option.sortBy
      });

      if (option.orderBy === 'ascending') {
        sortOrder.push('asc');
      }
      if (option.orderBy === 'descending') {
        sortOrder.push('desc');
      }
    });

    var mappedRecords = _.clone(records);
    mappedRecords = mappedRecords.map(function(record) {
      fields.forEach(function(field) {
        record.data['modified_' + field.column] = record.data[field.column] || '';
        record.data['modified_' + field.column] = record.data['modified_' + field.column].toString().toUpperCase();

        if (field.type === "alphabetical") {
          record.data['modified_' + field.column] = record.data['modified_' + field.column].normalize('NFD').match(/[A-Za-z]/)
            ? record.data['modified_' + field.column].normalize('NFD')
            : '{' + record.data['modified_' + field.column];
        }

        if (field.type === "numerical") {
          record.data['modified_' + field.column] = record.data['modified_' + field.column].match(/[0-9]/)
            ? parseInt(record.data['modified_' + field.column], 10)
            : record.data['modified_' + field.column];
        }

        if (field.type === "date") {
          // If an incorrect date format is used, the entry will be pushed at the end
          record.data['modified_' + field.column] = new Date(record.data['modified_' + field.column]).getTime();
        }

        if (field.type === "time") {
          record.data['modified_' + field.column] = record.data['modified_' + field.column];
        }

      });

      return record;
    });

    sortColumns = fields.map(function (field) {
      return 'data[modified_' + field.column + ']';
    })
    // Sort data
    records = _.orderBy(mappedRecords, sortColumns, sortOrder);
  }

  // Prepare filtering
  if (_this.data.filterOptions.length) {
    var filters = [];

    _this.data.filterOptions.forEach(function(option) {
      var filter = {
        column: option.column,
        condition: option.logic,
        value: option.value
      }
      filters.push(filter);
    });

    // Filter data
    filtered = _this.filterRecords(records, filters);
    records = filtered;
  }

  var prefiltered;
  var prefilters = [];
  if (_this.queryPreFilter) {
    _this.pvPreFilterQuery.forEach(function(option) {
      var filter = {
        column: option.column,
        condition: option.logic,
        value: option.value
      }
      prefilters.push(filter);
    });

    // Filter data
    prefiltered = _this.filterRecords(records, prefilters);
    records = prefiltered;
  }

  return records;
}

DynamicList.prototype.convertFiles = function(listItems) {
  var _this = this;
  var summaryDataToGetFile = [];
  var detailDataToGetFile = [];
  var promises = [];

  // Test pattern for URLS
  var urlPattern = /^https?:\/\//i;
  // Test pattern for BASE64 images
  var base64Pattern = /^data:image\/[^;]+;base64,/i;
  // Test pattern for DATASOURCES images
  var datasourcesPattern = /^datasources\//i;

  listItems.forEach(function(entry, index) {
    var summaryData = {
      query: {},
      entry: entry,
      entryIndex: index,
      field: undefined
    };

    var detailData = {
      query: {},
      entry: entry,
      entryIndex: index,
      field: undefined
    };

    _this.data['summary-fields'].forEach(function(obj) {
      if (!obj.imageField) {
        return;
      }

      if (obj.type === 'image' && obj.imageField !== 'url') {
        if (obj.imageField === 'app') {
          summaryData.query.appId = obj.appFolderId;
          summaryData.field = obj;
        }

        if (obj.imageField === 'organization') {
          summaryData.query.organizationId = obj.organizationFolderId;
          summaryData.field = obj;
        }

        if (obj.imageField === 'all-folders') {
          summaryData.query.folderId = obj.folder.selectFiles[0].id;
          summaryData.field = obj;
        }

        summaryDataToGetFile.push(summaryData);
      } else if (obj.type === 'image' && obj.imageField === 'url') {
        if (!urlPattern.test(entry.data[obj.column]) && !base64Pattern.test(entry.data[obj.column]) && !datasourcesPattern.test(entry.data[obj.column])) {
          listItems[index].data[obj.column] = '';
        }
      }
    });

    _this.data.detailViewOptions.forEach(function(obj) {
      if (!obj.imageField) {
        return;
      }

      if (obj.type === 'image' && obj.imageField !== 'url') {
        if (obj.imageField === 'app') {
          detailData.query.appId = obj.appFolderId;
          detailData.field = obj;
        }

        if (obj.imageField === 'organization') {
          detailData.query.organizationId = obj.organizationFolderId;
          detailData.field = obj;
        }

        if (obj.imageField === 'all-folders') {
          detailData.query.folderId = obj.folder.selectFiles[0].id;
          detailData.field = obj;
        }

        detailDataToGetFile.push(detailData);
      } else if (obj.type === 'image' && obj.imageField === 'url') {
        if (!urlPattern.test(entry.data[obj.column]) && !base64Pattern.test(entry.data[obj.column]) && !datasourcesPattern.test(entry.data[obj.column])) {
          listItems[index].data[obj.column] = '';
        }
      }
    });
  });

  if (summaryDataToGetFile.length) {
    summaryDataToGetFile.forEach(function(data) {
      promises.push(_this.connectToGetFiles(data));
    });
  }

  if (detailDataToGetFile.length) {
    detailDataToGetFile.forEach(function(data) {
      promises.push(_this.connectToGetFiles(data));
    });
  }

  if (promises.length) {
    return Promise.all(promises);
  }

  return Promise.resolve(listItems);
}

DynamicList.prototype.connectToGetFiles = function(data) {
  var _this = this;
  var cacheKey = JSON.stringify(data.query);

  if (!this.cachedFiles[cacheKey]) {
    this.cachedFiles[cacheKey] = Fliplet.Media.Folders.get(data.query)
      .then(function (response) {
        response.files.forEach(function (file) {
          if (file.isEncrypted) {
            file.url = Fliplet.Media.authenticate(file.url);
          }
        });

        return response;
      })
      .catch(function () {
        return Promise.resolve({ files: [], folders: [] });
      });
  }

  return this.cachedFiles[cacheKey]
    .then(function(response) {
      var allFiles = response.files;

      // Test pattern for URLS
      var urlPattern = /^https?:\/\//i;
      // Test pattern for BASE64 images
      var base64Pattern = /^data:image\/[^;]+;base64,/i;
      // Test pattern for DATASOURCES images
      var datasourcesPattern = /^datasources\//i;
      // Test pattern for Numbers/IDs
      var numberPattern = /^\d+$/i;

      if (!data.field) {
        return data.entry;
      }

      allFiles.forEach(function(file) {
        if (!_.compact(data.entry.data[data.field.column]).length) {
          return;
        }

        if (data.entry.data[data.field.column] && file.name.indexOf(data.entry.data[data.field.column]) !== -1) {
          data.entry.data[data.field.column] = file.url;
          // Save new temporary key to mark the URL as edited - Required (No need for a column with the same name)
          data.entry.data['imageUrlEdited'] = true;
        } else if (urlPattern.test(data.entry.data[data.field.column]) || base64Pattern.test(data.entry.data[data.field.column]) || datasourcesPattern.test(data.entry.data[data.field.column])) {
          // Save new temporary key to mark the URL as edited - Required (No need for a column with the same name)
          data.entry.data['imageUrlEdited'] = true;
        } else if (numberPattern.test(data.entry.data[data.field.column])) {
          var imageId = parseInt(data.entry.data[data.field.column], 10);
          if (imageId === file.id) {
            data.entry.data[data.field.column] = file.url;
            // Save new temporary key to mark the URL as edited - Required (No need for a column with the same name)
            data.entry.data['imageUrlEdited'] = true;
          }
        }
      });

      if (!data.entry.data['imageUrlEdited']) {
        data.entry.data[data.field.column] = '';
      }

      return data.entry;
    });
}

DynamicList.prototype.initialize = function() {
  var _this = this;

  // Render list with default data
  if (_this.data.defaultData) {
    // Render Base HTML template
    _this.renderBaseHTML();

    var records = _this.prepareData(_this.data.defaultEntries);
    _this.listItems = _this.getPermissions(records);
    _this.dataSourceColumns = _this.data.defaultColumns;

    return _this.convertFiles(_this.listItems)
      .then(function(response) {
        _this.listItems = _.uniqBy(response, function (item) {
          return item.id;
        });

        // Get user profile
        if (_this.myUserData) {
          // Create flag for current user
          _this.listItems.forEach(function(el, idx) {
            if (el.data[_this.emailField] === (_this.myUserData[_this.emailField] || _this.myUserData['email'])) {
              _this.listItems[idx].isCurrentUser = true;
            }
          });

          _this.myProfileData = _.filter(_this.listItems, function(row) {
            return row.isCurrentUser;
          });
        }

        // Render Loop HTML
        _this.prepareToRenderLoop(_this.listItems);
        _this.renderLoopHTML().then(function(){
          // Listeners and Ready
          _this.attachObservers();
        });
      });
  }

  var shouldInitFromQuery = _this.parseQueryVars();
  // query will always have higher priority than storage
  // if we find relevant terms in the query, delete the storage so the filters do not mix and produce side-effects
  if(shouldInitFromQuery){
    Fliplet.App.Storage.remove('flDynamicListQuery:' + _this.data.layout);
  };

  // Check if there is a query or PV for search/filter queries
  (shouldInitFromQuery ? Promise.resolve() : _this.parsePVQueryVars())
    .then(function() {
      // Render Base HTML template
      _this.renderBaseHTML();

      return _this.connectToDataSource();
    })
    .then(function (records) {
      return Fliplet.Hooks.run('flListDataAfterGetData', {
        config: _this.data,
        id: _this.data.id,
        uuid: _this.data.uuid,
        container: _this.$container,
        records: records
      }).then(function () {
        records = _this.prepareData(records);
        records = _this.getPermissions(records);
        // Make rows available Globally
        _this.listItems = records;

        // Get user profile
        if (_this.myUserData) {
          // Create flag for current user
          records.forEach(function(el, idx) {
            if (el.data[_this.emailField] === (_this.myUserData[_this.emailField] || _this.myUserData['email'])) {
              records[idx].isCurrentUser = true;
            }
          });

          _this.myProfileData = _.filter(records, function(row) {
            return row.isCurrentUser;
          });
        }
      });
    })
    .then(function() {
      if (!_this.data.detailViewAutoUpdate) {
        return Promise.resolve();
      }

      return Fliplet.DataSources.getById(_this.data.dataSourceId)
        .then(function(dataSource) {
          if (!dataSource) {
            return Promise.resolve();
          }

          _this.dataSourceColumns = dataSource.columns;
        })
        .catch(function () {
          return Promise.resolve(); // Resolve anyway if it fails
        });
    })
    .then(function() {
      return _this.convertFiles(_this.listItems);
    })
    .then(function(response) {
      _this.listItems = _.uniqBy(response, function (item) {
        return item.id;
      });

      // Render Loop HTML
      _this.prepareToRenderLoop(_this.listItems);
      _this.checkIsToOpen();
      _this.renderLoopHTML().then(function(){
        _this.attachObservers();
      });
      return;
    })
}

DynamicList.prototype.checkIsToOpen = function(options) {
  // List of entries saved in: _this.modifiedListItems

  options = options || {};

  var _this = this;
  var entry;

  if (!_this.queryOpen) {
    return;
  }

  if (_.hasIn(_this.pvOpenQuery, 'id')) {
    entry = _.find(_this.modifiedListItems, function(row) {
      return row.id === _this.pvOpenQuery.id;
    });
  }

  if (_.hasIn(_this.pvOpenQuery, 'value') && _.hasIn(_this.pvOpenQuery, 'column')) {
    entry = _.find(_this.modifiedListItems, function(row) {
      return row.originalData[_this.pvOpenQuery.column] === _this.pvOpenQuery.value;
    });
  }

  if (!entry) {
    // Entry not found
    if (options.silent) {
      return;
    }

    Fliplet.UI.Toast('Entry not found');
    return;
  }

  _this.showDetails(entry.id);
}

DynamicList.prototype.parseQueryVars = Fliplet.Registry.get('dynamicListQueryParser');

DynamicList.prototype.parsePVQueryVars = function() {
  var _this = this;
  var pvValue;

  return Fliplet.App.Storage.get('flDynamicListQuery:' + _this.data.layout)
    .then(function(value) {
      pvValue = value;

      if (typeof value === 'undefined') {
        Fliplet.App.Storage.remove('flDynamicListQuery:' + _this.data.layout);
        return;
      }

      _this.pvPreviousScreen = value.previousScreen;

      if (_.hasIn(value, 'prefilter')) {
        _this.queryPreFilter = true;
        _this.pvPreFilterQuery = value.prefilter;
      }

      if (_.hasIn(value, 'open')) {
        _this.queryOpen = true;
        _this.pvOpenQuery = value.open;
      }

      return;
    })
    .then(function() {
      if (pvValue && !pvValue.persist) {
        Fliplet.App.Storage.remove('flDynamicListQuery:' + _this.data.layout);
      }

      return;
    });
}

DynamicList.prototype.connectToDataSource = function() {
  var _this = this;
  var cache = { offline: true };

  function getData (options) {
    options = options || cache;
    return Fliplet.DataSources.connect(_this.data.dataSourceId, options)
      .then(function (connection) {
        // If you want to do specific queries to return your rows
        // See the documentation here: https://developers.fliplet.com/API/fliplet-datasources.html
        return connection.find(_this.queryOptions);
      });
  }

  return Fliplet.Hooks.run('flListDataBeforeGetData', {
    config: _this.data,
    id: _this.data.id,
    uuid: _this.data.uuid,
    container: _this.$container
  }).then(function() {
    if (_this.data.getData) {
      getData = _this.data.getData;

      if (_this.data.hasOwnProperty('cache')) {
        cache.offline = _this.data.cache;
      }
    }

    return getData(cache);
  }).catch(function (error) {
    Fliplet.UI.Toast({
      message: 'Error loading data',
      actions: [
        {
          label: 'Details',
          action: function () {
            Fliplet.UI.Toast({
              html: error.message || error
            });
          }
        }
      ]
    });
  });
}

DynamicList.prototype.renderBaseHTML = function() {
  // Function that renders the List container
  var _this = this;
  var baseHTML = '';

  var data = _this.getAddPermission(_this.data);

  // go to previous screen on close detail view - TRUE/FALSE
  data.previousScreen = _this.pvPreviousScreen;

  if (typeof _this.data.layout !== 'undefined') {
    baseHTML = Fliplet.Widget.Templates[_this.smallHorizontalLayoutMapping[_this.data.layout]['base']];
  }

  var template = _this.data.advancedSettings && _this.data.advancedSettings.baseHTML
  ? Handlebars.compile(_this.data.advancedSettings.baseHTML)
  : Handlebars.compile(baseHTML());

  $('[data-dynamic-lists-id="' + _this.data.id + '"]').html(template(data));
}

DynamicList.prototype.prepareToRenderLoop = function(records) {
  var _this = this;

  var savedColumns = [];
  var loopData = [];
  var notDynamicData = _.filter(_this.data.detailViewOptions, function(option) {
    return !option.editable;
  });
  var dynamicData = _.filter(_this.data.detailViewOptions, function(option) {
    return option.editable;
  });

  // Uses sumamry view settings set by users
  records.forEach(function(entry) {
    var newObject = {
      id: entry.id,
      editEntry: entry.editEntry,
      deleteEntry: entry.deleteEntry,
      isCurrentUser: entry.isCurrentUser ? entry.isCurrentUser : false,
      entryDetails: [],
      originalData: entry.data
    };
    _this.data['summary-fields'].some(function(obj) {
      var content = '';
      if (obj.column === 'custom') {
        content = Handlebars.compile(obj.customField)(entry.data)
      } else {
        var content = entry.data[obj.column];
      }
      newObject[obj.location] = content;
    });

    notDynamicData.some(function(obj) {
      if (!newObject[obj.location]) {
        var content = '';
        if (obj.column === 'custom') {
          content = Handlebars.compile(obj.customField)(entry.data)
        } else {
          var content = entry.data[obj.column];
        }
        newObject[obj.location] = content;
      }
    });


    dynamicData.forEach(function(dynamicDataObj) {
      var label = '';
      var labelEnabled = true;
      var content = '';

      // Define label
      if (dynamicDataObj.fieldLabel === 'column-name' && dynamicDataObj.column !== 'custom') {
        label = dynamicDataObj.column;
      }
      if (dynamicDataObj.fieldLabel === 'custom-label') {
        label = Handlebars.compile(dynamicDataObj.customFieldLabel)(entry.data);
      }
      if (dynamicDataObj.fieldLabel === 'no-label') {
        labelEnabled = false;
      }
      // Define content
      if (dynamicDataObj.customFieldEnabled) {
        content = Handlebars.compile(dynamicDataObj.customField)(entry.data);
      } else {
        content = entry.data[dynamicDataObj.column];
      }
      // Define data object
      var newEntryDetail = {
        id: entry.id,
        content: content,
        label: label,
        labelEnabled: labelEnabled,
        type: dynamicDataObj.type
      }

      newObject.entryDetails.push(newEntryDetail);
    });
    loopData.push(newObject);
  });

  savedColumns = dynamicData.map(function(data){
    return data.column;
  })

  var extraColumns = _.difference(_this.dataSourceColumns, savedColumns);
  loopData.forEach(function(obj, index) {
    if (_this.data.detailViewAutoUpdate && extraColumns.length) {
      var entryData = _.find(records, function(modEntry) {
        return modEntry.id === obj.id;
      });

      extraColumns.forEach(function(column) {
        var newColumnData = {
          id: entryData.id,
          content: entryData.data[column],
          label: column,
          labelEnabled: true,
          type: 'text'
        };

        obj.entryDetails.push(newColumnData);
      });
    }

    obj.profileHTML = _this.profileHTML(obj);
  });

  _this.modifiedListItems = loopData;
}

DynamicList.prototype.renderLoopHTML = function(iterateeCb) {
  // Function that renders the List template
  var _this = this;


  var template = _this.data.advancedSettings && _this.data.advancedSettings.loopHTML
    ? Handlebars.compile(_this.data.advancedSettings.loopHTML)
    : Handlebars.compile(Fliplet.Widget.Templates[_this.smallHorizontalLayoutMapping[_this.data.layout]['loop']]());

  _this.$container.find('#small-h-card-list-wrapper-' + _this.data.id).empty();

  var renderLoopIndex = 0;
  var data = _this.modifiedListItems;
  return new Promise(function(resolve){
    function render() {
      // get the next batch of items to render
      let nextBatch = data.slice(
        renderLoopIndex * _this.INCREMENTAL_RENDERING_BATCH_SIZE,
        renderLoopIndex * _this.INCREMENTAL_RENDERING_BATCH_SIZE + _this.INCREMENTAL_RENDERING_BATCH_SIZE
      );
      if (nextBatch.length) {
        _this.$container.find('#small-h-card-list-wrapper-' + _this.data.id).append(template(nextBatch));
        if(iterateeCb && typeof iterateeCb === 'function'){
          if(renderLoopIndex === 0){
            _this.$container.find('.new-small-h-card-list-container').addClass('ready');
          }
          iterateeCb(renderLoopIndex * _this.INCREMENTAL_RENDERING_BATCH_SIZE, renderLoopIndex * _this.INCREMENTAL_RENDERING_BATCH_SIZE + _this.INCREMENTAL_RENDERING_BATCH_SIZE);
        }
        renderLoopIndex++;
        // if the browser is ready, render
        requestAnimationFrame(render);
      }
      else{
        _this.$container.find('.new-small-h-card-list-container').addClass('ready');
        resolve();
      }
    }
    // start the initial render
    requestAnimationFrame(render);
})
}

DynamicList.prototype.getAddPermission = function(data) {
  var _this = this;

  if (typeof data.addEntry !== 'undefined' && typeof data.addPermissions !== 'undefined') {
    if (_this.myUserData && (_this.data.addPermissions === 'admins' || _this.data.addPermissions === 'users-admins')) {
      if (_this.myUserData[_this.data.userAdminColumn] !== null && typeof _this.myUserData[_this.data.userAdminColumn] !== 'undefined' && _this.myUserData[_this.data.userAdminColumn] !== '') {
        data.showAddEntry = data.addEntry;
      }
    } else if (_this.data.addPermissions === 'everyone') {
      data.showAddEntry = data.addEntry;
    }
  }

  return data;
}

DynamicList.prototype.getPermissions = function(entries) {
  var _this = this;

  // Adds flag for Edit and Delete buttons
  entries.forEach(function(obj, index) {
    if (typeof _this.data.editEntry !== 'undefined' && typeof _this.data.editPermissions !== 'undefined') {
      if (_this.myUserData && (_this.data.editPermissions === 'admins' || _this.data.editPermissions === 'users-admins')) {
        if (_this.myUserData[_this.data.userAdminColumn] !== null && typeof _this.myUserData[_this.data.userAdminColumn] !== 'undefined' && _this.myUserData[_this.data.userAdminColumn] !== '') {
          entries[index].editEntry = _this.data.editEntry;
        }
      } else if (_this.myUserData && (_this.data.editPermissions === 'user' || _this.data.editPermissions === 'users-admins')) {
        if (_this.myUserData[_this.data.userEmailColumn] === obj.data[_this.data.userListEmailColumn]) {
          entries[index].editEntry = _this.data.editEntry;
        }
      } else if (_this.data.addPermissions === 'everyone') {
        entries[index].editEntry = _this.data.editEntry;
      }
    }
    if (typeof _this.data.deleteEntry !== 'undefined' && typeof _this.data.deletePermissions !== 'undefined') {
      if (_this.myUserData && (_this.data.deletePermissions === 'admins' || _this.data.deletePermissions === 'users-admins')) {
        if (_this.myUserData[_this.data.userAdminColumn] !== null && typeof _this.myUserData[_this.data.userAdminColumn] !== 'undefined' && _this.myUserData[_this.data.userAdminColumn] !== '') {
          entries[index].deleteEntry = _this.data.deleteEntry;
        }
      } else if (_this.myUserData && (_this.data.deletePermissions === 'user' || _this.data.deletePermissions === 'users-admins')) {
        if (_this.myUserData[_this.data.userEmailColumn] === obj.data[_this.data.userListEmailColumn]) {
          entries[index].deleteEntry = _this.data.deleteEntry;
        }
      } else if (_this.data.deletePermissions === 'everyone') {
        entries[index].deleteEntry = _this.data.deleteEntry;
      }
    }
  });

  return entries;
}

DynamicList.prototype.openLinkAction = function(entryId) {
  var _this = this;
  var entry = _.find(_this.listItems, function(entry) {
    return entry.id === entryId;
  });

  if (!entry) {
    return;
  }

  var value = entry.data[_this.data.summaryLinkAction.column];

  if (_this.data.summaryLinkAction.type === 'url') {
    Fliplet.Navigate.url(value);
  } else {
    Fliplet.Navigate.screen(parseInt(value, 10), { transition: 'fade' });
  }
}

DynamicList.prototype.showDetails = function(id) {
  // Function that loads the selected entry data into an overlay for more details
  var _this = this;

  var entryData = _.find(_this.modifiedListItems, function(entry) {
    return entry.id === id;
  });
  // Process template with data
  var entryId = {
    id: id
  };
  var wrapper = '<div class="small-h-card-detail-wrapper" data-entry-id="{{id}}"></div>';
  var $overlay = _this.$container.find('#small-h-card-detail-overlay-' + _this.data.id);

  var src = _this.src;
  var beforeShowDetails = Promise.resolve({
    src: src,
    data: entryData
  });

  if (typeof _this.data.beforeShowDetails === 'function') {
    beforeShowDetails = _this.data.beforeShowDetails({
      config: _this.data,
      src: src,
      data: entryData
    });

    if (!(beforeShowDetails instanceof Promise)) {
      beforeShowDetails = Promise.resolve(beforeShowDetails);
    }
  }

  beforeShowDetails.then(function (data) {
    data = data || {};
    var template = Handlebars.compile(data.src || src);
    var wrapperTemplate = Handlebars.compile(wrapper);

    // This bit of code will only be useful if this component is added inside a Fliplet's Accordion component
    if (_this.$container.parents('.panel-group').not('.filter-overlay').length) {
      _this.$container.parents('.panel-group').not('.filter-overlay').addClass('remove-transform');
    }

    // Adds content to overlay
    $overlay.find('.small-h-card-detail-overlay-content-holder').html(wrapperTemplate(entryId));
    $overlay.find('.small-h-card-detail-wrapper').append(template(data.data || entryData));

    // Trigger animations
    _this.$container.find('.new-small-h-card-list-container').addClass('overlay-open');
    $overlay.addClass('open');
    setTimeout(function() {
      $overlay.addClass('ready');

      if (typeof _this.directoryDetailWrapper === 'undefined') {
        _this.directoryDetailWrapper = $('.small-h-card-list-item[data-entry-id="' + id + '"]').find('.small-h-card-list-detail-wrapper');
      }

      if (typeof _this.data.afterShowDetails === 'function') {
        _this.data.afterShowDetails({
          config: _this.data,
          src: data.src || src,
          data: data.data || entryData,
        });
      }
    }, 0);
  });
}

DynamicList.prototype.closeDetails = function() {
  // Function that closes the overlay
  var _this = this;

  var $overlay = _this.$container.find('#small-h-card-detail-overlay-' + _this.data.id);
  $overlay.removeClass('open');
  _this.$container.find('.new-small-h-card-list-container').removeClass('overlay-open');

  setTimeout(function() {
    $overlay.removeClass('ready');
    // Clears overlay
    $overlay.find('.small-h-card-detail-overlay-content-holder').html('');

    // This bit of code will only be useful if this component is added inside a Fliplet's Accordion component
    if (_this.$container.parents('.panel-group').not('.filter-overlay').length) {
      _this.$container.parents('.panel-group').not('.filter-overlay').removeClass('remove-transform');
    }
  }, 300);
}

DynamicList.prototype.expandElement = function(elementToExpand, id) {
  // Function called when a list item is tapped to expand
  var _this = this;

  // This bit of code will only be useful if this component is added inside a Fliplet's Accordion component
  if (elementToExpand.parents('.panel-group').length) {
    elementToExpand.parents('.panel-group').addClass('remove-transform');
  }

  //check to see if element is already expanded
  if (!elementToExpand.hasClass('open')) {
    // freeze the current scroll position of the background content
    $('body').addClass('lock');

    var currentPosition = elementToExpand.offset();
    var elementScrollTop = $(window).scrollTop();
    var netOffset = currentPosition.top - elementScrollTop;

    var expandPosition = $('body').offset();
    var expandTop = expandPosition.top;
    var expandLeft = expandPosition.left;
    var expandWidth = $('body').outerWidth();
    var expandHeight = $('html').outerHeight();

    var directoryDetailImageWrapper = elementToExpand.find('.small-h-card-list-detail-image-wrapper');
    var directoryDetailImage = elementToExpand.find('.small-h-card-list-detail-image');

    // convert the expand-item to fixed position with a high z-index without moving it
    elementToExpand.css({
      'top': netOffset,
      'left': currentPosition.left,
      'height': elementToExpand.height(),
      'width': elementToExpand.width(),
      'max-width': expandWidth,
      'position': 'fixed',
      'z-index': 1010,
    });

    elementToExpand.animate({
      'left': expandLeft,
      'top': expandTop,
      'height': expandHeight,
      'width': expandWidth,
      'max-width': expandWidth
    }, 200, 'linear', function() {
      _this.showDetails(id);
    });

    elementToExpand.addClass('open');
    elementToExpand.parents('.small-h-card-list-item').addClass('open');
    elementToExpand.find('.small-h-card-list-detail-content-scroll-wrapper').addClass('open');

    directoryDetailImageWrapper.css({
      height: directoryDetailImageWrapper.outerHeight(),
      'z-index': 12
    });

    directoryDetailImageWrapper.animate({
      height: '70vh'
    },
    200,
    'linear'
    );

    directoryDetailImage.css({
      height: directoryDetailImage.outerHeight(),
      'z-index': 12
    });

    directoryDetailImage.animate({
      height: '70vh'
    }, 200, 'linear');
  }
}

DynamicList.prototype.collapseElement = function(elementToCollapse) {
  // Function called when a list item is tapped to close
  var _this = this;

  $('body').removeClass('lock');

  var directoryDetailImageWrapper = elementToCollapse.find('.small-h-card-list-detail-image-wrapper');
  var directoryDetailImage = elementToCollapse.find('.small-h-card-list-detail-image');

  if (!directoryDetailImageWrapper.length || !directoryDetailImage.length) {
    _this.closeDetails();
  }

  var collapseTarget = elementToCollapse.parent();
  var elementScrollTop = $(window).scrollTop();
  var targetCollpsePlaceholderTop = collapseTarget.offset().top - elementScrollTop;
  var targetCollpsePlaceholderLeft = collapseTarget.offset().left;
  var targetCollapseHeight = collapseTarget.outerHeight();
  var targetCollapseWidth = collapseTarget.outerWidth();

  elementToCollapse.animate({
    top: targetCollpsePlaceholderTop,
    left: targetCollpsePlaceholderLeft,
    height: targetCollapseHeight,
    width: targetCollapseWidth
  }, 200, 'linear',
  function() {
    elementToCollapse.css({
      // after animating convert the collpase item to position absolute with a low z-index without moving it
      'position': 'absolute',
      'z-index': '1',
      'top': 0,
      'left': 0,
      'height': '100%',
      'width': '100%',
    });
  });

  directoryDetailImageWrapper.animate({
    height: targetCollapseHeight
  }, 200, 'linear');

  directoryDetailImage.animate({
    height: targetCollapseHeight
  }, 200, 'linear',
  function() {
    elementToCollapse.css({ height: '100%', });
    _this.closeDetails();

    // This bit of code will only be useful if this component is added inside a Fliplet's Accordion component
    // Only happens when the closing animation finishes
    if (elementToCollapse.parents('.panel-group').length) {
      elementToCollapse.parents('.panel-group').removeClass('remove-transform');
    }
  });

  elementToCollapse.removeClass('open');
  elementToCollapse.parents('.small-h-card-list-item').removeClass('open');
  elementToCollapse.find('.small-h-card-list-detail-content-scroll-wrapper').removeClass('open');
}